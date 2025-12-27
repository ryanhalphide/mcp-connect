import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: {
    service: 'mcp-connect',
    version: process.env.npm_package_version || '0.1.0',
  },
});

export const createChildLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};
