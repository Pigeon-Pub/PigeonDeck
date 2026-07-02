/* ============================================================
   replace-media.ts — 图片/视频替换弹层（阶段 4b）
   视觉照搬 preview/parts/25-replace-media.html 的 .rep 结构。
   双击图片/视频 → 弹层：选本地文件（FileReader→dataURL）或粘贴 URL。
   选定新 src 后经 onReplace 回调交给 DirectEditManager 提交（记录+历史+持久化上限判定）。
   挂 panel 层、标 data-pd-popover，点外部/Esc 关闭（mountPopover 管理）。
   ============================================================ */

import { t } from './i18n';
import { mountPopover, PopoverHandle } from './popover';

const uploadIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-4"/><path d="M3 15v4a2 2 0 0 0 2 2"/></svg>`;

export interface ReplaceMediaOptions {
  /** 浮层挂载容器（panel 层根） */
  root: HTMLElement;
  /** 锚点（被双击的图片/视频元素） */
  anchor: HTMLElement;
  /** 媒体类型（决定标题与 accept） */
  kind: 'image' | 'video';
  /** 选定新 src（dataURL 或 URL）回调 */
  onReplace: (newSrc: string) => void;
}

/** 打开替换弹层。返回句柄（选定/点外部自动关闭）。 */
export function openReplaceMedia(opts: ReplaceMediaOptions): PopoverHandle {
  const isImage = opts.kind === 'image';

  const rep = document.createElement('div');
  rep.className = 'pd-surface rep';
  rep.setAttribute('data-testid', 'pd-replace');

  const head = document.createElement('div');
  head.className = 'rep-h';
  head.textContent = isImage ? t('replace_img_title') : t('replace_video_title');
  rep.appendChild(head);

  const sub = document.createElement('div');
  sub.className = 'rep-sub';
  sub.textContent = t('replace_sub');
  rep.appendChild(sub);

  // ---- 本地文件 drop 区 ---- //
  const drop = document.createElement('div');
  drop.className = 'drop';
  drop.setAttribute('data-testid', 'pd-replace-drop');
  drop.innerHTML = uploadIcon;
  const d1 = document.createElement('span');
  d1.className = 'd1';
  d1.textContent = t('replace_pick_file');
  drop.appendChild(d1);
  const browseBtn = document.createElement('button');
  browseBtn.className = 'pd-btn';
  browseBtn.type = 'button';
  browseBtn.textContent = t('replace_browse');
  drop.appendChild(browseBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = isImage ? 'image/*' : 'video/*';
  fileInput.setAttribute('data-testid', 'pd-replace-file');
  fileInput.style.display = 'none';
  drop.appendChild(fileInput);

  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl) {
        handle.close();
        opts.onReplace(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  });
  rep.appendChild(drop);

  // ---- 「或」分隔 ---- //
  const or = document.createElement('div');
  or.className = 'or';
  or.textContent = t('replace_or');
  rep.appendChild(or);

  // ---- 粘贴 URL 行 ---- //
  const urlrow = document.createElement('div');
  urlrow.className = 'urlrow';
  const urlInput = document.createElement('input');
  urlInput.className = 'pd-input';
  urlInput.setAttribute('data-testid', 'pd-replace-url');
  urlInput.placeholder = t('replace_url_placeholder');
  urlrow.appendChild(urlInput);
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'pd-btn primary';
  confirmBtn.type = 'button';
  confirmBtn.setAttribute('data-testid', 'pd-replace-confirm');
  confirmBtn.textContent = t('replace_confirm');
  urlrow.appendChild(confirmBtn);

  const submitUrl = (): void => {
    const url = urlInput.value.trim();
    if (!url) return;
    handle.close();
    opts.onReplace(url);
  };
  confirmBtn.addEventListener('click', submitUrl);
  urlInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      submitUrl();
    }
  });
  rep.appendChild(urlrow);

  const handle = mountPopover(opts.root, rep, opts.anchor);
  return handle;
}
