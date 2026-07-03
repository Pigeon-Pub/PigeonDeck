/* ============================================================
   embed.ts — 拖拽嵌入（DOM 重父）纯函数
   交互12 / Bug3：默认拖拽把元素真正移入另一容器的 DOM 子树。
   拖放目标挑选 / 插入位置 / transform 解析，均无副作用，便于单测。
   ============================================================ */

/**
 * 从 elementsFromPoint 命中栈里挑选可接收的容器：
 * 跳过被拖元素自身、其后代、其祖先、以及工具自身 UI（shadowHost 子树）。
 * 栈按「最内层在前」（elementsFromPoint 语义），返回首个合格者 = 最深/最内层容器。
 */
export function pickDropTarget(
  stack: Element[],
  dragged: Element,
  shadowHost: Element
): Element | null {
  for (const el of stack) {
    if (el === dragged) continue;
    if (dragged.contains(el)) continue; // 后代
    if (el.contains(dragged)) continue; // 祖先
    if (el === shadowHost || shadowHost.contains(el)) continue; // 自身 UI
    return el;
  }
  return null;
}

/**
 * 按拖放点在候选子项起始坐标序列中挑插入下标：
 * 返回首个「起始坐标 > 拖放点」的下标（在其之前插入）；都不满足则返回末尾（追加）。
 * starts 为容器内子项（已排除被拖元素）沿主轴的起始坐标，DOM 顺序。
 */
export function pickInsertIndex(starts: number[], pointer: number): number {
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > pointer) return i;
  }
  return starts.length;
}

/** 解析 inline transform 里的 translate(xpx, ypx)；缺省/无 translate 返回 {0,0}。 */
export function parseTranslate(transform: string): { x: number; y: number } {
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const m = transform.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/);
  if (!m) return { x: 0, y: 0 };
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}
