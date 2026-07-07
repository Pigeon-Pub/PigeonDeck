/** Load a data URL into an image element for canvas drawing. */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Request a visible-tab screenshot from the background service worker. */
export async function requestCapture(): Promise<string> {
  const resp = (await chrome.runtime.sendMessage({ type: 'pd-capture' })) as
    | { dataUrl?: string; error?: string }
    | undefined;
  if (!resp?.dataUrl) {
    throw new Error(resp?.error ?? 'captureVisibleTab returned no dataUrl');
  }
  return resp.dataUrl;
}
