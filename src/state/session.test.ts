/* ============================================================
   session.test.ts — 会话序列化往返 + 防抖持久化
   ============================================================ */
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  serializeSession,
  deserializeSession,
  saveSession,
  restoreSession,
  bindSessionPersistence,
} from './session';
import { AnnotationStore, PageState } from './annotations';

const PAGE_KEY = 'https://example.com/page?a=1';

function sampleState(): PageState {
  return {
    nextNumber: 3,
    annotations: [
      {
        id: 'a1',
        number: 1,
        selector: '#hero',
        elementType: 'text',
        summary: 'h1 "标题"',
        note: '加大字号',
        changes: [],
        createdAt: 1720000000000,
        viewportPos: { x: 10, y: 20, w: 300, h: 48 },
      },
    ],
  };
}

beforeEach(() => sessionStorage.clear());

describe('session — 序列化往返', () => {
  it('serialize → deserialize 保留全部字段', () => {
    const raw = serializeSession(PAGE_KEY, sampleState());
    const state = deserializeSession(raw, PAGE_KEY);
    expect(state).toEqual(sampleState());
  });

  it('顶层按 pageKey 组织（V2 多页扩展点）', () => {
    const raw = serializeSession(PAGE_KEY, sampleState());
    const payload = JSON.parse(raw);
    expect(payload.version).toBe(1);
    expect(Object.keys(payload.pages)).toEqual([PAGE_KEY]);
  });

  it('页面键不匹配 → null', () => {
    const raw = serializeSession(PAGE_KEY, sampleState());
    expect(deserializeSession(raw, 'https://other.com/')).toBeNull();
  });

  it('损坏 JSON → null', () => {
    expect(deserializeSession('{oops', PAGE_KEY)).toBeNull();
    expect(deserializeSession('null', PAGE_KEY)).toBeNull();
    expect(deserializeSession('{"version":2,"pages":{}}', PAGE_KEY)).toBeNull();
  });
});

describe('session — sessionStorage 存取', () => {
  it('saveSession → restoreSession 往返', () => {
    saveSession(sampleState(), PAGE_KEY);
    expect(restoreSession(PAGE_KEY)).toEqual(sampleState());
  });

  it('无存储时 restoreSession 返回 null', () => {
    expect(restoreSession(PAGE_KEY)).toBeNull();
  });

  it('存储 key 带 pigeondeck: 前缀 + 完整 URL', () => {
    saveSession(sampleState(), PAGE_KEY);
    expect(sessionStorage.getItem(`pigeondeck:${PAGE_KEY}`)).toBeTruthy();
  });
});

describe('session — 防抖持久化', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('store 变化防抖后写入', () => {
    const store = new AnnotationStore();
    bindSessionPersistence(store, PAGE_KEY);

    store.add({
      selector: '#a',
      elementType: 'button',
      summary: 'button "go"',
      note: 'x',
      changes: [],
      viewportPos: { x: 0, y: 0, w: 10, h: 10 },
    });
    // 防抖窗口内未写
    expect(restoreSession(PAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(350);
    expect(restoreSession(PAGE_KEY)?.annotations.length).toBe(1);
  });

  it('连续变化合并为一次写入（以最终态为准）', () => {
    const store = new AnnotationStore();
    bindSessionPersistence(store, PAGE_KEY);

    const a = store.add({
      selector: '#a',
      elementType: 'text',
      summary: 'p',
      note: '1',
      changes: [],
      viewportPos: { x: 0, y: 0, w: 1, h: 1 },
    });
    store.update(a.id, { note: '2' });
    vi.advanceTimersByTime(350);

    expect(restoreSession(PAGE_KEY)?.annotations[0].note).toBe('2');
  });

  it('解绑时冲刷未落盘的更改', () => {
    const store = new AnnotationStore();
    const unbind = bindSessionPersistence(store, PAGE_KEY);

    store.add({
      selector: '#a',
      elementType: 'text',
      summary: 'p',
      note: 'x',
      changes: [],
      viewportPos: { x: 0, y: 0, w: 1, h: 1 },
    });
    unbind();
    expect(restoreSession(PAGE_KEY)?.annotations.length).toBe(1);
  });
});
