/**
 * SSE Client - Server-Sent Events client for real-time workflow updates
 */

export class SSEClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
    this.connections = new Map();
    this.subscribers = new Map();
  }

  /**
   * Subscribe to workflow execution events
   * @param {string} executionId - The execution ID to subscribe to
   * @param {function} callback - Callback function to handle events
   */
  subscribe(executionId, callback) {
    // Check if already connected
    if (this.connections.has(executionId)) {
      this.subscribers.get(executionId).push(callback);
      return;
    }

    // Create new SSE connection
    const eventSource = new EventSource(`${this.baseURL}/api/workflows/stream/${executionId}`);

    this.connections.set(executionId, eventSource);
    this.subscribers.set(executionId, [callback]);

    // Handle different event types
    eventSource.addEventListener('workflow.step.started', (event) => {
      const data = JSON.parse(event.data);
      this.notifySubscribers(executionId, { type: 'workflow.step.started', data });
    });

    eventSource.addEventListener('workflow.step.completed', (event) => {
      const data = JSON.parse(event.data);
      this.notifySubscribers(executionId, { type: 'workflow.step.completed', data });
    });

    eventSource.addEventListener('workflow.step.failed', (event) => {
      const data = JSON.parse(event.data);
      this.notifySubscribers(executionId, { type: 'workflow.step.failed', data });
    });

    eventSource.addEventListener('workflow.completed', (event) => {
      const data = JSON.parse(event.data);
      this.notifySubscribers(executionId, { type: 'workflow.completed', data });
      this.unsubscribe(executionId);
    });

    eventSource.addEventListener('workflow.failed', (event) => {
      const data = JSON.parse(event.data);
      this.notifySubscribers(executionId, { type: 'workflow.failed', data });
      this.unsubscribe(executionId);
    });

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      this.notifySubscribers(executionId, { type: 'error', data: { error: 'Connection failed' } });
      this.unsubscribe(executionId);
    };
  }

  /**
   * Notify all subscribers of an event
   */
  notifySubscribers(executionId, event) {
    const callbacks = this.subscribers.get(executionId) || [];
    callbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in SSE callback:', error);
      }
    });
  }

  /**
   * Unsubscribe from workflow execution events
   */
  unsubscribe(executionId) {
    const eventSource = this.connections.get(executionId);
    if (eventSource) {
      eventSource.close();
      this.connections.delete(executionId);
      this.subscribers.delete(executionId);
    }
  }

  /**
   * Unsubscribe from all connections
   */
  unsubscribeAll() {
    this.connections.forEach((eventSource) => {
      eventSource.close();
    });
    this.connections.clear();
    this.subscribers.clear();
  }
}

/**
 * Shared SSE Client instance
 */
export const sseClient = new SSEClient();
