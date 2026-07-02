/* ============================================================
   annotations.ts — 标注数据模型 + Store
   蓝图 §6.2：编号递增分配、删除不重排、清空后从 1 重置。
   数据结构预留 V2 多页扩展点：序列化顶层按 pageKey 组织（见 session.ts）。
   ============================================================ */

import type { ElementType } from '../shared/dom-utils';

/** 保存时元素的视口位置与尺寸（px，整数） */
export interface ViewportPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 一条样式/内容修改记录（蓝图 §5.1 样式修改输出格式）。
 * prop = 属性控件 key（fields.ts 注册表）；cssProp = CSS 属性名（text 内容修改为 'text'）；
 * oldValue = 修改前 computed/inline 值；newValue = 最新值。
 * 同一属性多次改动合并为一条（保留最初 oldValue、最新 newValue）。
 */
export interface StyleChange {
  prop: string;
  cssProp: string;
  oldValue: string;
  newValue: string;
}

/**
 * 合并两批修改记录：按 prop 合并（旧记录的 oldValue + 新记录的 newValue），
 * 改回原值（oldValue === newValue）的条目剔除。
 */
export function mergeChanges(prev: StyleChange[], next: StyleChange[]): StyleChange[] {
  const map = new Map<string, StyleChange>();
  for (const c of prev) map.set(c.prop, { ...c });
  for (const c of next) {
    const existing = map.get(c.prop);
    if (existing) {
      existing.newValue = c.newValue;
      existing.cssProp = c.cssProp;
    } else {
      map.set(c.prop, { ...c });
    }
  }
  return [...map.values()].filter((c) => c.oldValue !== c.newValue);
}

/** 一条标注记录 */
export interface Annotation {
  id: string;
  number: number;
  selector: string;
  elementType: ElementType;
  summary: string;
  note: string;
  changes: StyleChange[];
  createdAt: number;
  viewportPos: ViewportPos;
}

/** 新建标注的输入（id/number/createdAt 由 Store 分配） */
export type AnnotationInput = Omit<Annotation, 'id' | 'number' | 'createdAt'>;

/** 单页状态的序列化形态 */
export interface PageState {
  nextNumber: number;
  annotations: Annotation[];
}

export type StoreListener = (annotations: Annotation[]) => void;

let idCounter = 0;

function genId(): string {
  idCounter++;
  return `a${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export class AnnotationStore {
  private annotations: Annotation[] = [];
  private nextNumber = 1;
  private listeners: Set<StoreListener> = new Set();

  /** 订阅数据变化（UI 重渲染用）。返回取消订阅函数。 */
  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getAll();
    for (const l of this.listeners) {
      l(snapshot);
    }
  }

  /** 新增标注：编号递增分配 */
  add(input: AnnotationInput): Annotation {
    const annotation: Annotation = {
      ...input,
      id: genId(),
      number: this.nextNumber++,
      createdAt: Date.now(),
    };
    this.annotations.push(annotation);
    this.notify();
    return annotation;
  }

  /** 更新标注（id/number/createdAt 不可变） */
  update(id: string, patch: Partial<Omit<Annotation, 'id' | 'number' | 'createdAt'>>): Annotation | undefined {
    const idx = this.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    const updated = { ...this.annotations[idx], ...patch };
    this.annotations[idx] = updated;
    this.notify();
    return updated;
  }

  /** 删除标注：编号不重排，留空位 */
  remove(id: string): boolean {
    const idx = this.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.annotations.splice(idx, 1);
    this.notify();
    return true;
  }

  /**
   * 原样放回一条标注（撤销删除 / 重做新增用）：
   * 保留原 id/number/createdAt，按编号排序插入；nextNumber 不回退。
   */
  restore(annotation: Annotation): void {
    if (this.annotations.some((a) => a.id === annotation.id)) return;
    this.annotations.push(annotation);
    this.annotations.sort((a, b) => a.number - b.number);
    if (annotation.number >= this.nextNumber) {
      this.nextNumber = annotation.number + 1;
    }
    this.notify();
  }

  /** 清空：全部删除，编号从 1 重置 */
  clear(): void {
    this.annotations = [];
    this.nextNumber = 1;
    this.notify();
  }

  getAll(): Annotation[] {
    return [...this.annotations];
  }

  /** 下一个将被分配的编号（面板未保存时预显示用） */
  peekNextNumber(): number {
    return this.nextNumber;
  }

  getById(id: string): Annotation | undefined {
    return this.annotations.find((a) => a.id === id);
  }

  getBySelector(selector: string): Annotation | undefined {
    return this.annotations.find((a) => a.selector === selector);
  }

  /** 序列化当前页状态 */
  toPageState(): PageState {
    return {
      nextNumber: this.nextNumber,
      annotations: this.getAll(),
    };
  }

  /** 从序列化状态恢复（覆盖当前内容，保留原编号与 nextNumber） */
  load(state: PageState): void {
    this.annotations = [...state.annotations];
    this.nextNumber = state.nextNumber;
    this.notify();
  }
}
