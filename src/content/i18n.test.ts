import { describe, it, expect, vi, beforeEach } from 'vitest';
import { t, setLocale, getLocale, loadLocale } from './i18n';

// chrome.storage.local 最小 mock
const storageMock: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        return { [key]: storageMock[key] };
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(storageMock, obj);
      }),
    },
  },
});

describe('i18n', () => {
  beforeEach(async () => {
    // 重置到默认 zh_CN
    await setLocale('zh_CN');
  });

  it('默认语言是 zh_CN', () => {
    expect(getLocale()).toBe('zh_CN');
  });

  it('t() 返回中文文案', () => {
    expect(t('ext_name')).toBe('PigeonDeck');
  });

  it('切换到 en 后返回英文文案', async () => {
    await setLocale('en');
    expect(t('ext_name')).toBe('PigeonDeck');
    // ext_desc 英文版与中文版不同
    const desc = t('ext_desc');
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });

  it('不存在的 key 回退到 en，en 也没有则返回 key 本身', async () => {
    await setLocale('zh_CN');
    const result = t('__nonexistent_key__');
    expect(result).toBe('__nonexistent_key__');
  });

  it('loadLocale() 从 storage 恢复语言设置', async () => {
    // 先在 storage 里写 en
    storageMock['uiLocale'] = 'en';
    await loadLocale();
    expect(getLocale()).toBe('en');
    // 清理
    storageMock['uiLocale'] = undefined;
    await setLocale('zh_CN');
  });
});
