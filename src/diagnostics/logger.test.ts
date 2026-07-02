import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLevel, logger } from './logger';

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLevel('info'); // 恢复默认
  });

  it('默认 info 级别时 debug 不输出', () => {
    setLevel('info');
    logger.debug('should not print');
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('设置 debug 级别后 debug 输出', () => {
    setLevel('debug');
    logger.debug('hello');
    expect(console.debug).toHaveBeenCalledWith('[PigeonDeck]', 'hello');
  });

  it('info 及以上均输出', () => {
    setLevel('info');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
    expect(console.log).toHaveBeenCalledWith('[PigeonDeck]', 'info msg');
    expect(console.warn).toHaveBeenCalledWith('[PigeonDeck]', 'warn msg');
    expect(console.error).toHaveBeenCalledWith('[PigeonDeck]', 'error msg');
  });

  it('error 级别时 warn 不输出', () => {
    setLevel('error');
    logger.warn('should not print');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
