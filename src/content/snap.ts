/* ============================================================
   snap.ts — 拖拽移动吸附算法（纯函数，无 DOM 依赖）
   蓝图 §4.3 吸附算法（249 行）：
   扫描视口内可见块级元素 → 计算拖拽元素与候选的水平/垂直对齐距离 →
   阈值内（默认 4px）取最小修正量吸附，输出参考线 + 语义标识。
   语义标识为稳定字符串（如 'align-left'），move.ts 负责翻译为界面文案，
   保持本模块纯净可单测。
   ============================================================ */

/** 轴对齐矩形（视口坐标，px） */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 一条参考线：方向 + 位置 + 覆盖范围（供 overlay 画线） */
export interface Guide {
  /** 'v' = 竖线（X 对齐），'h' = 横线（Y 对齐） */
  orient: 'v' | 'h';
  /** 竖线的 x 坐标 / 横线的 y 坐标（视口，px） */
  pos: number;
  /** 覆盖范围起点（竖线用 top，横线用 left） */
  start: number;
  /** 覆盖范围终点（竖线用 bottom，横线用 right） */
  end: number;
  /** 对齐语义标识（move.ts 翻译）：如 'align-left'/'align-center-h' */
  semantic: string;
}

/** 吸附结果 */
export interface SnapResult {
  /** X 轴吸附修正量（叠加到原始 dx） */
  dx: number;
  /** Y 轴吸附修正量（叠加到原始 dy） */
  dy: number;
  /** 参考线列表（可为空） */
  guides: Guide[];
  /** 命中的对齐语义标识列表（供展示第一条即可） */
  semantics: string[];
}

/** 一个带语义 key 的对齐锚点 */
interface Anchor {
  key: string;
  value: number;
}

/** X 轴三个对齐锚点：左 / 中心 / 右 */
function xAnchors(r: Rect): Anchor[] {
  return [
    { key: 'left', value: r.left },
    { key: 'center', value: r.left + r.width / 2 },
    { key: 'right', value: r.left + r.width },
  ];
}

/** Y 轴三个对齐锚点：上 / 中心 / 下 */
function yAnchors(r: Rect): Anchor[] {
  return [
    { key: 'top', value: r.top },
    { key: 'center', value: r.top + r.height / 2 },
    { key: 'bottom', value: r.top + r.height },
  ];
}

/** X 轴对齐语义标识（dragged 锚点 × candidate 锚点） */
function xSemantic(dKey: string, cKey: string): string {
  if (dKey === 'center' && cKey === 'center') return 'align-center-h';
  if (dKey === cKey) {
    if (dKey === 'left') return 'align-left';
    if (dKey === 'right') return 'align-right';
  }
  return 'align-x';
}

/** Y 轴对齐语义标识 */
function ySemantic(dKey: string, cKey: string): string {
  if (dKey === 'center' && cKey === 'center') return 'align-center-v';
  if (dKey === cKey) {
    if (dKey === 'top') return 'align-top';
    if (dKey === 'bottom') return 'align-bottom';
  }
  return 'align-y';
}

interface AxisHit {
  /** 需要施加的修正量（吸附后 dragged 锚点对齐候选锚点） */
  correction: number;
  /** 参考线位置（对齐后的公共坐标线） */
  guidePos: number;
  semantic: string;
  candRect: Rect;
}

/**
 * 单轴吸附求解：在候选锚点集中找阈值内最小修正量（≤ 阈值命中）。
 * 相同距离保留先命中的（稳定），仅严格更小才替换。
 */
function solveAxis(
  draggedAnchors: Anchor[],
  candidates: Rect[],
  anchorsOf: (r: Rect) => Anchor[],
  semanticOf: (dKey: string, cKey: string) => string,
  threshold: number
): AxisHit | null {
  let best: AxisHit | null = null;
  let bestAbs = Infinity;

  for (const cand of candidates) {
    for (const cAnchor of anchorsOf(cand)) {
      for (const dAnchor of draggedAnchors) {
        const delta = cAnchor.value - dAnchor.value; // 施加该修正后对齐
        const abs = Math.abs(delta);
        if (abs <= threshold && abs < bestAbs) {
          best = {
            correction: delta,
            guidePos: cAnchor.value,
            semantic: semanticOf(dAnchor.key, cAnchor.key),
            candRect: cand,
          };
          bestAbs = abs;
        }
      }
    }
  }
  return best;
}

/**
 * snapDrag — 拖拽吸附主函数。
 * @param dragged   拖拽元素「按原始位移后」的目标矩形（视口坐标）
 * @param candidates 视口内可对齐的候选块级元素矩形（不含拖拽元素自身）
 * @param threshold 吸附阈值（px，默认 4）
 * @returns X/Y 轴吸附修正量 + 参考线 + 语义标识
 */
export function snapDrag(dragged: Rect, candidates: Rect[], threshold = 4): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guides: [], semantics: [] };
  if (candidates.length === 0) return result;

  // X 轴（竖参考线）
  const xHit = solveAxis(xAnchors(dragged), candidates, xAnchors, xSemantic, threshold);
  if (xHit) {
    result.dx = xHit.correction;
    result.semantics.push(xHit.semantic);
    // 竖线覆盖范围：拖拽元素与候选的 top..bottom 并集
    const top = Math.min(dragged.top, xHit.candRect.top);
    const bottom = Math.max(dragged.top + dragged.height, xHit.candRect.top + xHit.candRect.height);
    result.guides.push({ orient: 'v', pos: xHit.guidePos, start: top, end: bottom, semantic: xHit.semantic });
  }

  // Y 轴（横参考线）
  const yHit = solveAxis(yAnchors(dragged), candidates, yAnchors, ySemantic, threshold);
  if (yHit) {
    result.dy = yHit.correction;
    result.semantics.push(yHit.semantic);
    const leftAfter = dragged.left + result.dx; // 应用 X 吸附后的左边
    const left = Math.min(leftAfter, yHit.candRect.left);
    const right = Math.max(leftAfter + dragged.width, yHit.candRect.left + yHit.candRect.width);
    result.guides.push({ orient: 'h', pos: yHit.guidePos, start: left, end: right, semantic: yHit.semantic });
  }

  return result;
}
