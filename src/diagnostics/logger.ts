/* ============================================================
   logger.ts — 极简分级 logger
   统一前缀 [PigeonDeck]，debug 默认关闭。
   ============================================================ */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLevel(level: LogLevel): void {
  currentLevel = level;
}

const PREFIX = '[PigeonDeck]';

function log(level: LogLevel, ...args: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const fn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'debug' ? console.debug
    : console.log;
  fn(PREFIX, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info:  (...args: unknown[]) => log('info',  ...args),
  warn:  (...args: unknown[]) => log('warn',  ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
