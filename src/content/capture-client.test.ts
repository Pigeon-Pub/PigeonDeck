// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadImage, requestCapture } from './capture-client';

type ChromeRuntimeMock = {
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
  };
};

class MockImage {
  onload: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;
  naturalWidth = 1;
  naturalHeight = 1;

  set src(value: string) {
    if (value === 'fail') {
      this.onerror?.(new Error('image failed'));
      return;
    }
    this.onload?.();
  }
}

function stubChromeResponse(response: unknown): ReturnType<typeof vi.fn> {
  const sendMessage = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('chrome', { runtime: { sendMessage } } satisfies ChromeRuntimeMock);
  return sendMessage;
}

describe('requestCapture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests a pd-capture screenshot from the background worker', async () => {
    const sendMessage = stubChromeResponse({ dataUrl: 'data:image/png;base64,ok' });

    await expect(requestCapture()).resolves.toBe('data:image/png;base64,ok');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'pd-capture' });
  });

  it('throws the background error when capture fails', async () => {
    stubChromeResponse({ error: 'blocked page' });

    await expect(requestCapture()).rejects.toThrow('blocked page');
  });

  it('throws a fallback error when the response has no dataUrl', async () => {
    stubChromeResponse({});

    await expect(requestCapture()).rejects.toThrow('captureVisibleTab returned no dataUrl');
  });
});

describe('loadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with the loaded image element', async () => {
    vi.stubGlobal('Image', MockImage);

    const img = await loadImage('data:image/png;base64,ok');

    expect(img).toBeInstanceOf(MockImage);
  });

  it('rejects when image decoding fails', async () => {
    vi.stubGlobal('Image', MockImage);

    await expect(loadImage('fail')).rejects.toThrow('image failed');
  });
});
