/* ============================================================
   service-worker.ts — MV3 background service worker
   阶段 9a：captureVisibleTab 截图消息处理 + 限速（≥600ms 间隔）。
   ============================================================ */

import { logger } from '../diagnostics/logger';

/** 安装说明页地址（扩展内静态页，public/onboarding.html 构建时复制到 dist/） */
const ONBOARDING_URL = 'onboarding.html';

chrome.runtime.onInstalled.addListener((details) => {
  logger.info('PigeonDeck installed', details.reason);
  // 阶段 12：仅首次安装自动打开安装说明页（update 时不弹）
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_URL) });
  }
});

/**
 * 处理内容侧「打开安装说明页」请求 { type: 'pd-open-onboarding' }。
 * 设置面板 Help 分区的按钮触发；独立 listener，不影响 pd-capture 分支。
 */
chrome.runtime.onMessage.addListener(
  (msg: unknown, _sender, sendResponse: (resp: { ok: boolean }) => void) => {
    if (
      typeof msg !== 'object' ||
      msg === null ||
      (msg as Record<string, unknown>)['type'] !== 'pd-open-onboarding'
    ) {
      return false;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_URL) });
    sendResponse({ ok: true });
    return false; // 同步响应
  }
);

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
