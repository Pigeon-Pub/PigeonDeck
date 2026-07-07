/* ============================================================
   eyedropper.ts — 页内取色器（F18c）
   彻底替换原生 EyeDropper API：其系统级输入捕获在部分真机上拾取落定后
   不释放（颜色已变但整屏乃至浏览器窗口都点不动），脚本层无法解救。
   改为：请求一帧 captureVisibleTab 截图 → feedback 层全视口覆盖层冻结
   显示 → 放大镜跟随光标 → 单击读取像素返回 hex → Esc/右键取消。
   覆盖层是自有 DOM，关闭即消失，不存在系统捕获态。
   ============================================================ */

import { pushEsc } from './esc-stack';
import { loadImage, requestCapture } from './capture-client';

/** 放大镜采样格数（奇数，中心格 = 即将拾取的像素） */
const LOUPE_CELLS = 11;
/** 单格放大倍率（px） */
const LOUPE_ZOOM = 10;
const LOUPE_SIZE = LOUPE_CELLS * LOUPE_ZOOM;
/** 放大镜与光标的间距（px） */
const LOUPE_OFFSET = 14;

/** r/g/b（0–255）→ '#rrggbb' */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * 视口 CSS 坐标 → 截图像素坐标。scale = 截图宽/视口宽（吸收 devicePixelRatio
 * 与页面缩放），向下取整后钳制在 [0, max-1]。
 */
export function viewportToImage(client: number, scale: number, max: number): number {
  return Math.min(max - 1, Math.max(0, Math.floor(client * scale)));
}

/**
 * 打开页内取色器：截取当前可视区一帧 → root 上挂全视口覆盖层冻结显示 →
 * 放大镜跟随光标 → 单击拾取该像素 resolve '#rrggbb'；Esc/右键取消 resolve null。
 * 截图或解码失败（受限页等）时 reject。
 */
export async function pickColor(root: HTMLElement): Promise<string | null> {
  const dataUrl = await requestCapture();
  const img = await loadImage(dataUrl);

  // 截图铺进原尺寸像素画布：拾取像素与放大镜都从这里读
  const src = document.createElement('canvas');
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('eyedropper: no 2d context');
  sctx.drawImage(img, 0, 0);

  const scaleX = src.width / window.innerWidth;
  const scaleY = src.height / window.innerHeight;

  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pd-eyedropper';
    overlay.setAttribute('data-testid', 'pd-eyedropper');

    // 截图铺满视口 = 视觉上冻结当前画面（与拾取像素严格同源）
    const shot = document.createElement('img');
    shot.className = 'ed-shot';
    shot.src = dataUrl;
    shot.draggable = false;
    overlay.appendChild(shot);

    const loupe = document.createElement('div');
    loupe.className = 'loupe';
    loupe.hidden = true;
    const zoom = document.createElement('canvas');
    zoom.width = LOUPE_SIZE;
    zoom.height = LOUPE_SIZE;
    const hexLabel = document.createElement('span');
    hexLabel.className = 'hex';
    loupe.append(zoom, hexLabel);
    overlay.appendChild(loupe);
    const zctx = zoom.getContext('2d');

    const pixelAt = (ev: MouseEvent): { x: number; y: number; hex: string } => {
      const x = viewportToImage(ev.clientX, scaleX, src.width);
      const y = viewportToImage(ev.clientY, scaleY, src.height);
      const d = sctx.getImageData(x, y, 1, 1).data;
      return { x, y, hex: rgbToHex(d[0], d[1], d[2]) };
    };

    let popEsc: () => void = () => {};
    const done = (hex: string | null): void => {
      popEsc();
      overlay.remove();
      resolve(hex);
    };

    overlay.addEventListener('mousemove', (ev) => {
      const { x, y, hex } = pixelAt(ev);
      if (zctx) {
        zctx.imageSmoothingEnabled = false;
        zctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
        const half = Math.floor(LOUPE_CELLS / 2);
        zctx.drawImage(src, x - half, y - half, LOUPE_CELLS, LOUPE_CELLS, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
        // 中心格描边 = 即将拾取的像素
        zctx.strokeStyle = 'rgba(255,255,255,.92)';
        zctx.lineWidth = 1;
        zctx.strokeRect(half * LOUPE_ZOOM + 0.5, half * LOUPE_ZOOM + 0.5, LOUPE_ZOOM - 1, LOUPE_ZOOM - 1);
      }
      hexLabel.textContent = hex;
      loupe.hidden = false;
      // 贴近右/下缘时翻到光标另一侧
      const w = loupe.offsetWidth || LOUPE_SIZE;
      const h = loupe.offsetHeight || LOUPE_SIZE;
      const left =
        ev.clientX + LOUPE_OFFSET + w > window.innerWidth
          ? ev.clientX - LOUPE_OFFSET - w
          : ev.clientX + LOUPE_OFFSET;
      const top =
        ev.clientY + LOUPE_OFFSET + h > window.innerHeight
          ? ev.clientY - LOUPE_OFFSET - h
          : ev.clientY + LOUPE_OFFSET;
      loupe.style.left = `${left}px`;
      loupe.style.top = `${top}px`;
    });
    overlay.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      done(pixelAt(ev).hex);
    });
    overlay.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      done(null);
    });
    popEsc = pushEsc(() => done(null));

    root.appendChild(overlay);
  });
}
