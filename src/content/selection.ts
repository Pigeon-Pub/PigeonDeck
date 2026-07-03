/* ============================================================
   selection.ts — 选择粒度解析器（移动 + 批注面板共用）
   蓝图 §4.3：两档基准（smart / element）+ 相对偏移记忆（+/- 胶囊驱动）。
   ============================================================ */

import { resolveComponentBlock } from './visual-units';

/** 从基准元素在 DOM 链中向更深子孙方向收窄（负偏移）。
 * 策略：沿 firstElementChild 链向下走 |offset| 级。
 * 若中途遇到命中目标元素则停在那里；否则走到最深一级。
 */
function narrowDown(base: HTMLElement, steps: number, hitEl: HTMLElement): HTMLElement {
  let cur: HTMLElement = base;
  for (let i = 0; i < steps; i++) {
    // 如果 hitEl 是 cur 的后代，向 hitEl 方向收窄（选出包含 hitEl 的子元素）
    if (cur.contains(hitEl) && cur !== hitEl) {
      // 找出 cur 中包含 hitEl 的直接子元素
      let child: HTMLElement | null = null;
      for (const c of cur.children) {
        if (c === hitEl || c.contains(hitEl)) {
          child = c as HTMLElement;
          break;
        }
      }
      if (child) {
        cur = child;
        continue;
      }
    }
    // hitEl 不在 cur 内（偏移超出范围），走 firstElementChild
    const first = cur.firstElementChild as HTMLElement | null;
    if (!first) break;
    cur = first;
  }
  return cur;
}

/** 从元素向祖先爬升 N 级（正偏移）。遇到 body/html 停止。 */
function ascend(base: HTMLElement, steps: number): HTMLElement {
  let cur: HTMLElement = base;
  const body = base.ownerDocument.body;
  const root = base.ownerDocument.documentElement;
  for (let i = 0; i < steps; i++) {
    const parent = cur.parentElement;
    if (!parent || parent === body || parent === root) break;
    cur = parent;
  }
  return cur;
}

export class SelectionResolver {
  private granularity: 'smart' | 'element';
  /** 相对偏移：正 = 向祖先爬 N 级，负 = 向子孙收窄 N 级。0 = 基准本身。 */
  private offset = 0;

  constructor(granularity: 'smart' | 'element') {
    this.granularity = granularity;
  }

  /** 更新基准粒度（settings 变化时） */
  setGranularity(g: 'smart' | 'element'): void {
    this.granularity = g;
    if (g === 'element') this.offset = 0; // element 基准无意义做偏移
  }

  getGranularity(): 'smart' | 'element' {
    return this.granularity;
  }

  /** 当前偏移量 */
  getOffset(): number {
    return this.offset;
  }

  /** 调整偏移量（+1 = 向祖先，-1 = 向子孙） */
  adjustOffset(delta: 1 | -1): void {
    this.offset += delta;
  }

  /** 重置偏移（新页面或用户主动重置时） */
  resetOffset(): void {
    this.offset = 0;
  }

  /**
   * 解析：给定命中元素，返回应被选中的目标元素。
   * 步骤：基准 → 应用偏移 → 返回结果。
   */
  resolve(hitEl: HTMLElement): HTMLElement {
    // 基准
    let base: HTMLElement;
    if (this.granularity === 'smart') {
      base = resolveComponentBlock(hitEl);
    } else {
      base = hitEl;
    }

    // 偏移 = 0：直接返回基准
    if (this.offset === 0) return base;

    if (this.offset > 0) {
      // 向祖先爬升
      return ascend(base, this.offset);
    } else {
      // 向子孙收窄（负偏移）
      return narrowDown(base, -this.offset, hitEl);
    }
  }
}
