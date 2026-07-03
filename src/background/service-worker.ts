/* ============================================================
   service-worker.ts — MV3 background service worker
   阶段 9a：captureVisibleTab 截图消息处理 + 限速（≥600ms 间隔）。
   ============================================================ */

import { logger } from '../diagnostics/logger';

chrome.runtime.onInstalled.addListener((details) => {
  logger.info('PigeonDeck installed', details.reason);
});

/** 上次截图时间戳（ms），用于限速 */
let lastCaptureTime = 0;
/** captureVisibleTab 最小间隔（Chrome 每秒最多 2 次） */
const CAPTURE_MIN_INTERVAL_MS = 600;

/**
 * 处理内容侧截图请求 { type: 'pd-capture' }。
 * 限速：若距上次截图 <600ms 则等待补足再截。
 */
chrome.runtime.onMessage.addListener(
  (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (resp: { dataUrl?: string; error?: string }) => void
  ) => {
    if (
      typeof msg !== 'object' ||
      msg === null ||
      (msg as Record<string, unknown>)['type'] !== 'pd-capture'
    ) {
      return false;
    }

    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ error: 'no windowId in sender' });
      return false;
    }

    (async () => {
      // 限速：补足到 CAPTURE_MIN_INTERVAL_MS
      const now = Date.now();
      const wait = CAPTURE_MIN_INTERVAL_MS - (now - lastCaptureTime);
      if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
      lastCaptureTime = Date.now();

      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        sendResponse({ dataUrl });
      } catch (err) {
        logger.error('captureVisibleTab failed', err);
        sendResponse({ error: String(err) });
      }
    })();

    return true; // 异步 sendResponse
  }
);
