/* ============================================================
   main.ts — PigeonDeck content script 入口
   Shadow DOM 宿主注入 + 四层结构 + 设计令牌 + 工具盘 + 批注链路
   ============================================================ */

import designTokensCss from './design-tokens.css?inline';
import baseCss from './base.css?inline';
import { loadLocale, t } from './i18n';
import { logger } from '../diagnostics/logger';
import { Controller } from './controller';
import { Toolbar } from './toolbar';
import { Overlay } from './overlay';
import { PanelManager } from './panel';
import { Toast } from './toast';
import { AnnotationStore, Annotation } from '../state/annotations';
import { History } from '../state/history';
import { restoreSession, bindSessionPersistence } from '../state/session';
import { loadSettings, Settings } from '../state/settings';
import { loadDisableState, isPageDisabled, KEY_GLOBAL, KEY_SITES } from '../state/disable';
import { DirectEditManager } from './direct-edit';
import { RegionSelectManager } from './region-select';
import { SelectionResolver } from './selection';
import { MoveManager } from './move';
import { CopyTextManager } from './copy-text';
import { CopyImageManager } from './capture';
import { ClearManager } from './clear';
import { SettingsManager } from './settings-panel';
import { setupShortcuts } from './shortcuts';

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

function inject(settings: Settings): void {
  // 防重复注入
  if (document.getElementById(HOST_ID)) {
    logger.debug('already injected, skipping');
    return;
  }

  // 宿主元素
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-theme', settings.theme);
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

  // 实例化 Controller
  const controller = new Controller();
  const controlLayer = shadow.querySelector<HTMLElement>('[data-layer="control"]')!;

  // 阶段 13b：右键菜单「快速标注」→ 展开工具盘（= 进入批注模式）
  chrome.runtime.onMessage.addListener((msg) => {
    if (
      typeof msg === 'object' &&
      msg !== null &&
      (msg as Record<string, unknown>)['type'] === 'pd-context-annotate'
    ) {
      controller.expand();
    }
  });

  // 批注链路：Store + 会话恢复 + 覆盖层 + 面板 + 轻提示
  const panelLayer = shadow.querySelector<HTMLElement>('[data-layer="panel"]')!;
  const overlayLayer = shadow.querySelector<HTMLElement>('[data-layer="overlay"]')!;
  const feedbackLayer = shadow.querySelector<HTMLElement>('[data-layer="feedback"]')!;

  const store = new AnnotationStore();
  const restored = restoreSession();
  if (restored) store.load(restored);
  bindSessionPersistence(store);

  // 撤销/重做历史栈（先建，Toolbar 需引用）
  const history = new History(settings.historyLimit);

  // Toolbar（接受 history，用于按钮禁用态订阅）
  const toolbar = new Toolbar(controller, controlLayer, history);

  // 接线撤销/重做瞬时动作
  controller.setCallbacks({
    onUndo: () => history.undo(),
    onRedo: () => history.redo(),
  });

  // 快捷键（仅展开态：Ctrl+Z / Ctrl+Shift+Z / Esc）
  setupShortcuts(controller, history);

  const toast = new Toast(feedbackLayer);

  // Overlay 与 PanelManager 互相引用：先建 Overlay（hooks 后挂），再建 PanelManager
  const hooks: {
    onPinClick?: (a: Annotation) => void;
    onPinContextMenu?: (a: Annotation, pinEl: HTMLElement) => void;
  } = {};
  const overlay = new Overlay(controller, store, overlayLayer, feedbackLayer, settings, {
    onPinClick: (a) => hooks.onPinClick?.(a),
    onPinContextMenu: (a, pinEl) => hooks.onPinContextMenu?.(a, pinEl),
  });
  const panelManager = new PanelManager(controller, store, overlay, panelLayer, settings, history, toast);
  hooks.onPinClick = panelManager.togglePinCard;
  hooks.onPinContextMenu = panelManager.openPinMenu;

  // 阶段 4a：直接编辑（双击文本元素 → 内联编辑 + 富文本浮条）
  new DirectEditManager({
    controller,
    store,
    history,
    overlay,
    panelLayer,
    settings,
    toast,
    panel: panelManager,
  });

  // 阶段 5：区域框选（长按 ≥300ms → 拖拽框选 → 区域批注面板）
  new RegionSelectManager({
    controller,
    store,
    history,
    overlayLayer,
    panelLayer,
    panel: panelManager,
    settings,
  });

  // 阶段 6a：移动模式（单击选中 + 选择粒度 + 八向句柄缩放）
  const selectionResolver = new SelectionResolver(settings.defaultGranularity);
  panelManager.setResolver(selectionResolver);
  new MoveManager({
    controller,
    store,
    history,
    resolver: selectionResolver,
    overlayLayer,
    settings,
  });

  // 阶段 8b：复制文本（生成任务清单 → 剪贴板 + 结果弹窗 + 语言快切 + 下载）
  new CopyTextManager({
    controller,
    store,
    settings,
    toast,
    panelLayer,
  });

  // 阶段 9a/9b：复制图片（截图拼接 + 叠加绘制 + 剪贴板/下载 + 水印）
  new CopyImageManager({
    controller,
    store,
    settings,
    toast,
    panelLayer,
  });

  // 阶段 10：清空确认（贴工具盘确认弹层，确认=复合命令可撤销）
  new ClearManager({
    controller,
    store,
    history,
    toast,
    controlLayer,
    panelLayer,
  });

  // 阶段 11a：设置面板（4 分区导航 + 非语言控件；共享同一 settings 引用即时生效）
  new SettingsManager({
    controller,
    settings,
    panelLayer,
    controlLayer,
    overlay,
    history,
    resolver: selectionResolver,
    toast,
    onResetPosition: () => toolbar.resetPosition(),
    // 阶段 12：发消息给后台打开安装说明页
    onOpenOnboarding: () => chrome.runtime.sendMessage({ type: 'pd-open-onboarding' }),
  });

  // 恢复后：未能定位的标注数据保留、UI 跳过，轻提示
  if (restored && restored.annotations.length > 0) {
    const missing = overlay.getUnresolvedCount();
    if (missing > 0) {
      toast.show(t('toast_restore_missing').replace('{n}', String(missing)));
    }
    // 卡片默认展开设置：为可定位的标注展开卡片
    if (settings.cardDefaultExpanded) {
      for (const a of store.getAll()) {
        if (overlay.getTargetRect(a.id)) panelManager.openCard(a);
      }
    }
  }

  logger.info('Shadow DOM injected with toolbar + annotation');
}

/**
 * 监听禁用状态变化：仅当「当前页禁用态实际翻转」（与当前是否已注入矛盾）时
 * reload。用重载实现实时启停——禁用后重载守卫跳过注入（UI 消失），启用后
 * 重载恢复注入（标注在 sessionStorage 天然恢复）。无残留监听 bug。
 */
function registerDisableWatcher(): void {
  if (!chrome?.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!(KEY_GLOBAL in changes) && !(KEY_SITES in changes)) return;
    void loadDisableState().then((dis) => {
      const shouldBeDisabled = isPageDisabled(location.href, dis.global, dis.sites);
      const isInjected = !!document.getElementById(HOST_ID);
      // 只在禁用态与注入态矛盾时重载，避免无关变化误刷。
      if (shouldBeDisabled === isInjected) {
        location.reload();
      }
    });
  });
}

async function main(): Promise<void> {
  await loadLocale();
  const settings = await loadSettings();

  // 无论是否注入，都注册禁用状态监听（Popup 切换开关后本页据此重载）。
  registerDisableWatcher();

  // 注入守卫：全局禁用 or 当前站点在禁用列表 → 跳过注入。
  const dis = await loadDisableState();
  if (isPageDisabled(location.href, dis.global, dis.sites)) {
    logger.info('disabled on this page, skip inject');
    return;
  }

  inject(settings);
}

main().catch((err) => logger.error('init failed', err));
