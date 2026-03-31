import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const isDev = process.env.NODE_ENV !== 'production';

/** Paths redacted in all log output — prevents secrets leaking in error/debug logs. */
export const REDACT_PATHS = [
  '*.apiKey',
  '*.token',
  '*.privateKey',
  '*.encryptionKey',
  '*.password',
  '*.secret',
  '*.authorization',
  'apiKey',
  'token',
  'privateKey',
  'encryptionKey',
  'password',
  'secret',
  'authorization',
];

export const logger = pino({
  level,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});
