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

/** 一条标注记录。changes 本阶段恒空数组，3b（修改栏/样式）填充。 */
export interface Annotation {
  id: string;
  number: number;
  selector: string;
  elementType: ElementType;
  summary: string;
  note: string;
  changes: unknown[];
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
