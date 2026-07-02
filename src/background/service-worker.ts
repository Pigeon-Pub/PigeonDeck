/* ============================================================
   service-worker.ts — MV3 background service worker
   骨架阶段：监听安装事件并记录日志。
   ============================================================ */

import { logger } from '../diagnostics/logger';

chrome.runtime.onInstalled.addListener((details) => {
  logger.info('PigeonDeck installed', details.reason);
});
