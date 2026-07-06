// @vitest-environment jsdom
/* ============================================================
   region-select.test.ts — 区域批注编辑路径（F16）
   验证 region 标注（selector=''）经卡片/菜单「修改」时不走元素解析，
   而是路由回可编辑的区域面板，且保存更新原标注而非新建。
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { RegionSelectManager } from './region-select';
import { Controller } from './controller';
import { AnnotationStore, Annotation } from '../state/annotations';
import { History } from '../state/history';
import { DEFAULT_SETTINGS } from '../state/settings';
import type { PanelManager } from './panel';

function setup(): { mgr: RegionSelectManager; store: AnnotationStore; panelLayer: HTMLElement } {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const overlayLayer = document.createElement('div');
  const panelLayer = document.createElement('div');
  shadow.appendChild(overlayLayer);
  shadow.appendChild(panelLayer);
  document.body.appendChild(host);

  const store = new AnnotationStore();
  const panelStub = {
    cancelPendingOpen() {},
    suppressNextClick() {},
  } as unknown as PanelManager;

  const mgr = new RegionSelectManager({
    controller: new Controller(),
    store,
    history: new History(),
    overlayLayer,
    panelLayer,
    panel: panelStub,
    settings: { ...DEFAULT_SETTINGS },
  });
  return { mgr, store, panelLayer };
}

function addRegion(store: AnnotationStore, note: string): Annotation {
  return store.add({
    kind: 'region',
    selector: '',
    elementType: 'other',
    summary: 'region 100×80',
    note,
    changes: [],
    viewportPos: { x: 10, y: 20, w: 100, h: 80 },
    region: { docRect: { x: 10, y: 20, w: 100, h: 80 }, elements: [] },
  });
}

describe('RegionSelectManager.editRegion — 区域批注编辑（F16）', () => {
  it('打开预填说明的区域面板', () => {
    const { mgr, store, panelLayer } = setup();
    addRegion(store, '原说明');
    mgr.editRegion(store.getAll()[0]);
    const panel = panelLayer.querySelector('[data-testid="pd-region-panel"]');
    expect(panel).toBeTruthy();
    const ta = panel!.querySelector<HTMLTextAreaElement>('[data-testid="pd-region-note"]')!;
    expect(ta.value).toBe('原说明');
  });

  it('保存更新原标注而非新建（id/编号不变，数量不增）', () => {
    const { mgr, store, panelLayer } = setup();
    const orig = addRegion(store, '原说明');
    mgr.editRegion(store.getAll()[0]);
    const panel = panelLayer.querySelector('[data-testid="pd-region-panel"]')!;
    const ta = panel.querySelector<HTMLTextAreaElement>('[data-testid="pd-region-note"]')!;
    ta.value = '改后说明';
    panel.querySelector<HTMLButtonElement>('[data-testid="pd-region-save"]')!.click();
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(orig.id);
    expect(all[0].number).toBe(orig.number);
    expect(all[0].note).toBe('改后说明');
  });

  it('非 region 标注调用 editRegion 不开面板', () => {
    const { mgr, store, panelLayer } = setup();
    store.add({
      selector: 'div',
      elementType: 'container',
      summary: 'div',
      note: 'x',
      changes: [],
      viewportPos: { x: 0, y: 0, w: 1, h: 1 },
    });
    mgr.editRegion(store.getAll()[0]);
    expect(panelLayer.querySelector('[data-testid="pd-region-panel"]')).toBeNull();
  });
});
