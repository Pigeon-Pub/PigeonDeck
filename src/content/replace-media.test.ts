// @vitest-environment jsdom
/* ============================================================
   replace-media.test.ts — openReplaceMedia 回调参数
   覆盖：上传本地文件时 onReplace 收到 (dataUrl, fileName)；
         粘贴 URL 提交时 onReplace 收到 (url, undefined)。
   ============================================================ */

import { describe, it, expect, vi } from 'vitest';
import { openReplaceMedia } from './replace-media';

/** 搭一个最简 mountPopover stub（同测试环境中 popover.ts 依赖 Shadow DOM，直接注入） */
vi.mock('./popover', () => ({
  mountPopover: (_root: HTMLElement, el: HTMLElement, _anchor: HTMLElement) => {
    _root.appendChild(el);
    return { close: () => el.remove() };
  },
}));

vi.mock('./i18n', () => ({
  t: (key: string) => key,
}));

describe('openReplaceMedia — onReplace callback', () => {
  function setup(kind: 'image' | 'video' = 'image') {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const anchor = document.createElement('img');
    document.body.appendChild(anchor);
    const onReplace = vi.fn();
    const handle = openReplaceMedia({ root, anchor, kind, onReplace });
    return { root, anchor, onReplace, handle };
  }

  it('上传本地文件：onReplace 接收 (dataUrl, file.name)', () => {
    const { root, onReplace } = setup();

    const fileInput = root.querySelector<HTMLInputElement>('[data-testid="pd-replace-file"]');
    expect(fileInput).toBeTruthy();

    // 模拟 FileReader.readAsDataURL
    const fakeDataUrl = 'data:image/png;base64,abc123';
    const originalFileReader = globalThis.FileReader;
    class MockFileReader {
      result = fakeDataUrl;
      onload: (() => void) | null = null;
      readAsDataURL(_file: Blob): void {
        // 同步触发 onload
        this.onload?.();
      }
    }
    (globalThis as unknown as Record<string, unknown>).FileReader = MockFileReader;

    const file = new File(['dummy'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(fileInput!, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput!.dispatchEvent(new Event('change'));

    // 恢复
    (globalThis as unknown as Record<string, unknown>).FileReader = originalFileReader;

    expect(onReplace).toHaveBeenCalledOnce();
    const args = onReplace.mock.calls[0] as [string, string | undefined];
    expect(args[0]).toBe(fakeDataUrl);
    expect(args[1]).toBe('photo.png');
  });

  it('粘贴 URL 提交：onReplace 接收 (url, undefined)', () => {
    const { root, onReplace } = setup();

    const urlInput = root.querySelector<HTMLInputElement>('[data-testid="pd-replace-url"]')!;
    const confirmBtn = root.querySelector<HTMLButtonElement>('[data-testid="pd-replace-confirm"]')!;
    urlInput.value = 'https://cdn.example.com/banner.png';
    confirmBtn.click();

    expect(onReplace).toHaveBeenCalledOnce();
    const args = onReplace.mock.calls[0] as [string, string | undefined];
    expect(args[0]).toBe('https://cdn.example.com/banner.png');
    expect(args[1]).toBeUndefined();
  });
});

