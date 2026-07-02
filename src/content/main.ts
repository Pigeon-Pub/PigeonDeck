/* ============================================================
   main.ts — PigeonDeck content script 入口
   Shadow DOM 宿主注入 + 四层结构 + 设计令牌
   ============================================================ */

import designTokensCss from './design-tokens.css?inline';
import baseCss from './base.css?inline';
import { loadLocale } from './i18n';
import { logger } from '../diagnostics/logger';

// 防重复注入标记
const HOST_ID = 'pd-host';

type Theme = 'light' | 'dark';

let _shadowRoot: ShadowRoot | null = null;

/** 切换亮/暗主题 */
export function setTheme(theme: Theme): void {
  if (_shadowRoot) {
    (_shadowRoot.host as HTMLElement).setAttribute('data-theme', theme);
  }
}

function inject(): void {
  // 防重复注入
  if (document.getElementById(HOST_ID)) {
    logger.debug('already injected, skipping');
    return;
  }

  // 宿主元素
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-theme', 'light');
  Object.assign(host.style, {
    position: 'fixed',
    zIndex: '2147483647',
    inset: '0',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(host);

  // Shadow Root
  const shadow = host.attachShadow({ mode: 'open' });
  _shadowRoot = shadow;

  // 注入样式
  const style = document.createElement('style');
  style.textContent = designTokensCss + '\n' + baseCss;
  shadow.appendChild(style);

  // 四层容器（蓝图 §3.1）
  const layers: Array<'control' | 'panel' | 'overlay' | 'feedback'> = [
    'control',
    'panel',
    'overlay',
    'feedback',
  ];
  for (const layer of layers) {
    const el = document.createElement('div');
    el.setAttribute('data-layer', layer);
    shadow.appendChild(el);
  }

  logger.info('Shadow DOM injected');
}

async function main(): Promise<void> {
  await loadLocale();
  inject();
}

main().catch((err) => logger.error('init failed', err));
