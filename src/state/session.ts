/* ============================================================
   session.ts — 会话持久化（sessionStorage）
   蓝图 §6.1：按标签页会话，页面键 = 完整 URL。
   sessionStorage 天然匹配 tab 会话：刷新在、关 tab 清。
   序列化顶层按 pageKey 组织，预留 V2 多页扩展点。
   ============================================================ */

import type { AnnotationStore, PageState } from './annotations';

const KEY_PREFIX = 'pigeondeck:';
const SAVE_DEBOUNCE_MS = 300;

/**
 * dataURL 持久化字符长度上限（~1MB）。
 * sessionStorage 约 5MB，单个超大 dataURL 会让整页 setItem 失败、整页状态丢失。
 * 超上限的媒体替换 change 序列化时剔除 → 只活在内存，刷新不恢复（符合规格）。
 */
export const MAX_PERSIST_DATAURL = 1_000_000;

/** 顶层按 pageKey 组织（V2 多页扩展点） */
interface SessionPayload {
  version: 1;
  pages: Record<string, PageState>;
}

/** 页面键 = 完整 URL */
export function getPageKey(): string {
  return location.href;
}

function storageKey(pageKey: string): string {
  return KEY_PREFIX + pageKey;
}

/**
 * 序列化前净化：深拷贝副本，剔除超上限的 dataURL 媒体替换 change（不改内存态）。
 * 仅剔除 cssProp==='src' 且 newValue 以 'data:' 开头且长度超 MAX_PERSIST_DATAURL 的 change。
 */
export function sanitizeForPersist(state: PageState): PageState {
  return {
    nextNumber: state.nextNumber,
    annotations: state.annotations.map((a) => ({
      ...a,
      changes: a.changes.filter(
        (c) =>
          !(
            c.cssProp === 'src' &&
            c.newValue.startsWith('data:') &&
            c.newValue.length > MAX_PERSIST_DATAURL
          )
      ),
    })),
  };
}

/** 序列化单页状态为存储载荷（先净化超大 dataURL） */
export function serializeSession(pageKey: string, state: PageState): string {
  const payload: SessionPayload = {
    version: 1,
    pages: { [pageKey]: sanitizeForPersist(state) },
  };
  return JSON.stringify(payload);
}

/** 反序列化。载荷损坏或页面键缺失时返回 null。 */
export function deserializeSession(raw: string, pageKey: string): PageState | null {
  try {
    const payload = JSON.parse(raw) as SessionPayload;
    if (payload.version !== 1 || typeof payload.pages !== 'object' || payload.pages === null) {
      return null;
    }
    const state = payload.pages[pageKey];
    if (!state || typeof state.nextNumber !== 'number' || !Array.isArray(state.annotations)) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

/** 注入时读取当前页会话状态 */
export function restoreSession(pageKey: string = getPageKey()): PageState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(pageKey));
    if (!raw) return null;
    return deserializeSession(raw, pageKey);
  } catch {
    return null;
  }
}

/** 立即写入当前页会话状态 */
export function saveSession(state: PageState, pageKey: string = getPageKey()): void {
  try {
    sessionStorage.setItem(storageKey(pageKey), serializeSession(pageKey, state));
  } catch {
    // 存储不可用/超限时静默失败，内存态不受影响
  }
}

/**
 * 绑定 Store → sessionStorage 的防抖持久化。
 * 返回解绑函数（解绑时冲刷未落盘的更改）。
 */
export function bindSessionPersistence(
  store: AnnotationStore,
  pageKey: string = getPageKey()
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    saveSession(store.toPageState(), pageKey);
  };

  const unsubscribe = store.subscribe(() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      flush();
    }
  };
}
