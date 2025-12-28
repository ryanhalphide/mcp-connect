import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createChildLogger } from '../observability/logger.js';
import { appEvents } from '../core/events.js';

const logger = createChildLogger({ module: 'websocket-transport' });

export interface WebSocketConfig {
  url: string;
  headers?: Record<string, string>;
  reconnect: {
    enabled: boolean;
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
  heartbeat: {
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
  };
}

export type WebSocketState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed';

/**
 * Robust WebSocket transport with automatic reconnection and heartbeat support.
 * Implements the MCP Transport interface with production-grade reliability.
 */
export class RobustWebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private serverId: string;
  private serverName: string;

  // Connection state
  private state: WebSocketState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
  private lastPongReceived: Date | null = null;
  private pendingMessages: JSONRPCMessage[] = [];
  private isClosing = false;

  // Event handlers (required by Transport interface)
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(serverId: string, serverName: string, config: WebSocketConfig) {
    this.serverId = serverId;
    this.serverName = serverName;
    this.config = config;
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketState {
    return this.state;
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    state: WebSocketState;
    reconnectAttempts: number;
    lastPongReceived: Date | null;
    pendingMessages: number;
  } {
    return {
      state: this.state,
      reconnectAttempts: this.reconnectAttempts,
      lastPongReceived: this.lastPongReceived,
      pendingMessages: this.pendingMessages.length,
    };
  }

  /**
   * Start the WebSocket connection
   */
  async start(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      logger.warn({ serverId: this.serverId }, 'WebSocket already connected or connecting');
      return;
    }

    this.isClosing = false;
    await this.connect();
  }

  /**
   * Internal connect method with error handling
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.setState('connecting');

        // Convert http(s) to ws(s) if needed
        let wsUrl = this.config.url;
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        } else if (wsUrl.startsWith('https://')) {
          wsUrl = wsUrl.replace('https://', 'wss://');
        }

        logger.info(
          { serverId: this.serverId, serverName: this.serverName, url: wsUrl },
          'Connecting to WebSocket'
        );

        // Create WebSocket with headers (Note: browser WebSocket doesn't support headers natively,
        // but Node.js ws library and some server implementations do via subprotocol or query params)
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          logger.info(
            { serverId: this.serverId, serverName: this.serverName },
            'WebSocket connected'
          );

          this.setState('connected');
          this.reconnectAttempts = 0;

          // Start heartbeat if enabled
          if (this.config.heartbeat.enabled) {
            this.startHeartbeat();
          }

          // Flush pending messages
          this.flushPendingMessages();

          // Emit connection event
          appEvents.emitServerConnected(this.serverId, this.serverName, 0);

          resolve();
        };

        this.ws.onclose = (event) => {
          logger.info(
            { serverId: this.serverId, code: event.code, reason: event.reason },
            'WebSocket closed'
          );

          this.stopHeartbeat();

          if (!this.isClosing && this.config.reconnect.enabled) {
            this.handleReconnect();
          } else {
            this.setState('disconnected');
            this.onclose?.();
          }
        };

        this.ws.onerror = (event) => {
          const error = new Error(`WebSocket error: ${event.type}`);
          logger.error(
            { serverId: this.serverId, error: error.message },
            'WebSocket error'
          );

          if (this.state === 'connecting') {
            reject(error);
          }

          this.onerror?.(error);
          appEvents.emitServerError(this.serverId, this.serverName, error.message);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = typeof event.data === 'string' ? event.data : event.data.toString();

            // Handle pong responses for heartbeat
            if (data === 'pong' || data === '{"type":"pong"}') {
              this.lastPongReceived = new Date();
              this.clearHeartbeatTimeout();
              return;
            }

            const message = JSON.parse(data) as JSONRPCMessage;
            this.onmessage?.(message);
          } catch (error) {
            logger.error(
              { serverId: this.serverId, error, data: event.data },
              'Failed to parse WebSocket message'
            );
          }
        };

      } catch (error) {
        this.setState('failed');
        reject(error);
      }
    });
  }

  /**
   * Handle automatic reconnection with exponential backoff
   */
  private handleReconnect(): void {
    if (this.isClosing) {
      return;
    }

    if (this.reconnectAttempts >= this.config.reconnect.maxAttempts) {
      logger.error(
        { serverId: this.serverId, attempts: this.reconnectAttempts },
        'Max reconnection attempts reached'
      );
      this.setState('failed');
      this.onerror?.(new Error('Max reconnection attempts reached'));
      appEvents.emitServerError(this.serverId, this.serverName, 'Max reconnection attempts reached');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.reconnect.initialDelayMs * Math.pow(this.config.reconnect.backoffMultiplier, this.reconnectAttempts - 1),
      this.config.reconnect.maxDelayMs
    );

    logger.info(
      { serverId: this.serverId, attempt: this.reconnectAttempts, delayMs: delay },
      'Scheduling reconnection'
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error(
          { serverId: this.serverId, error, attempt: this.reconnectAttempts },
          'Reconnection attempt failed'
        );
        this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Start heartbeat ping/pong mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
          this.setHeartbeatTimeout();
        } catch (error) {
          logger.error({ serverId: this.serverId, error }, 'Failed to send heartbeat');
        }
      }
    }, this.config.heartbeat.intervalMs);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  /**
   * Set timeout for heartbeat response
   */
  private setHeartbeatTimeout(): void {
    this.heartbeatTimeoutTimer = setTimeout(() => {
      logger.warn(
        { serverId: this.serverId, timeoutMs: this.config.heartbeat.timeoutMs },
        'Heartbeat timeout - connection may be dead'
      );

      // Force close to trigger reconnect
      this.ws?.close(4000, 'Heartbeat timeout');
    }, this.config.heartbeat.timeoutMs);
  }

  /**
   * Clear heartbeat timeout
   */
  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Update connection state
   */
  private setState(newState: WebSocketState): void {
    const oldState = this.state;
    this.state = newState;

    logger.debug(
      { serverId: this.serverId, oldState, newState },
      'WebSocket state changed'
    );
  }

  /**
   * Flush any messages that were queued while disconnected
   */
  private flushPendingMessages(): void {
    if (this.pendingMessages.length === 0) {
      return;
    }

    logger.info(
      { serverId: this.serverId, count: this.pendingMessages.length },
      'Flushing pending messages'
    );

    const messages = [...this.pendingMessages];
    this.pendingMessages = [];

    for (const message of messages) {
      this.send(message).catch((error) => {
        logger.error({ serverId: this.serverId, error }, 'Failed to send pending message');
      });
    }
  }

  /**
   * Send a message through the WebSocket
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.state !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message if reconnecting
      if (this.state === 'reconnecting' && this.config.reconnect.enabled) {
        logger.debug(
          { serverId: this.serverId, messageId: (message as { id?: unknown }).id },
          'Queueing message while reconnecting'
        );
        this.pendingMessages.push(message);
        return;
      }

      throw new Error(`WebSocket not connected (state: ${this.state})`);
    }

    const data = JSON.stringify(message);
    this.ws.send(data);
  }

  /**
   * Close the WebSocket connection
   */
  async close(): Promise<void> {
    logger.info({ serverId: this.serverId }, 'Closing WebSocket connection');

    this.isClosing = true;

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();

    // Close WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Normal closure');
      }
      this.ws = null;
    }

    this.setState('disconnected');
    this.pendingMessages = [];

    appEvents.emitServerDisconnected(this.serverId, this.serverName);
  }

  /**
   * Force reconnect (useful for manual recovery)
   */
  async forceReconnect(): Promise<void> {
    logger.info({ serverId: this.serverId }, 'Forcing reconnection');

    this.isClosing = false;
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.close(4001, 'Forced reconnect');
    }

    await this.connect();
  }
}

/**
 * Create a WebSocket transport instance
 */
export function createWebSocketTransport(
  serverId: string,
  serverName: string,
  config: WebSocketConfig
): RobustWebSocketTransport {
  return new RobustWebSocketTransport(serverId, serverName, config);
}
