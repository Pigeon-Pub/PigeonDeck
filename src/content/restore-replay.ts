/* ============================================================
   restore-replay.ts — 刷新恢复：重放 DOM 副作用 + 重建撤销历史
   （Cluster W5b Bug1）
   store.load(restored) 只恢复标注「数据」，本模块补两件事：
   1) 把每条标注的 DOM 副作用（样式/内容修改、transform 位移、重父嵌入）重放到
      刷新后的页面上，使被改元素恢复外观、被移动元素停在移动位置（不回弹）。
   2) 为每条恢复的标注按创建顺序 push 一条撤销命令，使刷新后的标注可撤销
      （Ctrl+Z 先撤最新）。
   重父撤销用「捕获的元素引用」（抗选择器漂移），与 move.ts commitEmbed 一致。
   每次 inject 只调用一次（main.ts 在 store.load + history 建好后、UI 管理器建好前）。
   ============================================================ */

import { AnnotationStore, Annotation, StyleChange } from '../state/annotations';
import { History, Command } from '../state/history';
import { applyChangesTo } from './panel';
import { buildSelector } from '../shared/dom-utils';

/** 唯一命中才返回（与 overlay/move 的解析口径一致；空选择器/非法选择器返回 null） */
function resolveUnique(selector: string): HTMLElement | null {
  if (!selector) return null;
  try {
    const m = document.querySelectorAll(selector);
    return m.length === 1 && m[0] instanceof HTMLElement ? m[0] : null;
  } catch {
    return null;
  }
}

/**
 * 重放全部已恢复标注的 DOM 副作用，并为每条 push 一条撤销命令。
 * 按 store.getAll()（创建顺序）遍历——push 后 undo 栈顶为最新一条，Ctrl+Z 先撤最新。
 * getAll() 返回快照副本，即便重父路径中途 store.update 也不影响遍历。
 */
export function replayRestoredAnnotations(store: AnnotationStore, history: History): void {
  for (const annotation of store.getAll()) {
    history.push(replayOne(store, annotation));
  }
}

/** 数据级命令：无 DOM 副作用（区域标注 / 无法定位的元素）。仍可撤销/重做。 */
function dataOnlyCommand(store: AnnotationStore, annotation: Annotation): Command {
  return {
    label: 'restore',
    revert: () => {
      store.remove(annotation.id);
    },
    apply: () => {
      store.restore(annotation);
    },
  };
}

/** 重放单条标注的 DOM 副作用（立即执行），返回其撤销命令。 */
function replayOne(store: AnnotationStore, annotation: Annotation): Command {
  // 区域标注：overlay 从数据渲染，无 DOM 回放
  if (annotation.kind === 'region') return dataOnlyCommand(store, annotation);

  const move = annotation.move;

  // 重父嵌入移动：按 fromSelector 在刷新后的原始位置解析元素、toSelector 解析容器
  if (move?.reparent) {
    return replayReparent(store, annotation, move.reparent, annotation.changes);
  }

  // 普通元素：样式/内容修改 + transform 位移（按 selector 解析）
  const el = resolveUnique(annotation.selector);
  if (!el) return dataOnlyCommand(store, annotation);

  const changes = annotation.changes;

  const applyEffect = (): void => {
    if (changes.length > 0) applyChangesTo(el, changes, 'new');
    if (move) el.style.transform = `translate(${move.dx}px, ${move.dy}px)`;
  };
  const revertEffect = (): void => {
    if (changes.length > 0) applyChangesTo(el, changes, 'old');
    if (move) el.style.transform = '';
  };

  // 立即重放
  applyEffect();

  return {
    label: 'restore',
    revert: () => {
      revertEffect();
      store.remove(annotation.id);
    },
    apply: () => {
      store.restore(annotation);
      applyEffect();
    },
  };
}

/**
 * 重父嵌入的重放：把元素追加进目标容器（原始子序号未持久化，V1 接受追加），
 * 清空 transform（元素在容器内自然排布）；同时重放该元素上的样式/内容修改。
 * 撤销用「捕获的元素引用 + 原父/原兄弟/原 transform」复原（抗选择器漂移）。
 * selector 每次重父后同步为当下位置（overlay 据此解析标注框），与 commitEmbed 一致。
 */
function replayReparent(
  store: AnnotationStore,
  annotation: Annotation,
  reparent: { fromSelector: string; toSelector: string },
  changes: StyleChange[]
): Command {
  const el = resolveUnique(reparent.fromSelector);
  const container = resolveUnique(reparent.toSelector);
  if (!el || !container) return dataOnlyCommand(store, annotation);

  const originalParent = el.parentElement;
  if (!originalParent) return dataOnlyCommand(store, annotation);
  // 撤销用：捕获原始 DOM 位置 + inline transform（刷新后通常为空）
  const originalNextSibling = el.nextSibling;
  const originalTransform = el.style.transform;

  const doEmbed = (): void => {
    if (changes.length > 0) applyChangesTo(el, changes, 'new');
    container.appendChild(el);
    el.style.transform = '';
  };
  const undoEmbed = (): void => {
    if (changes.length > 0) applyChangesTo(el, changes, 'old');
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(el, originalNextSibling);
    } else {
      originalParent.appendChild(el);
    }
    el.style.transform = originalTransform;
  };

  // 立即重放：嵌入 + 同步 selector
  doEmbed();
  store.update(annotation.id, { selector: buildSelector(el) });

  return {
    label: 'restore',
    revert: () => {
      undoEmbed();
      store.remove(annotation.id);
    },
    apply: () => {
      store.restore(annotation);
      doEmbed();
      store.update(annotation.id, { selector: buildSelector(el) });
    },
  };
}
