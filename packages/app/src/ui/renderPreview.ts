function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Maps a click on an `object-fit: contain` image back to its natural pixel coordinates, or null if the click landed in the letterboxed padding. */
function pixelCoordsFromClick(img: HTMLImageElement, e: MouseEvent): { x: number; y: number } | null {
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (!naturalW || !naturalH) return null;

  const rect = img.getBoundingClientRect();
  const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
  const drawnW = naturalW * scale;
  const drawnH = naturalH * scale;
  const offsetX = (rect.width - drawnW) / 2;
  const offsetY = (rect.height - drawnH) / 2;

  const xInDrawn = e.clientX - rect.left - offsetX;
  const yInDrawn = e.clientY - rect.top - offsetY;
  if (xInDrawn < 0 || yInDrawn < 0 || xInDrawn >= drawnW || yInDrawn >= drawnH) return null;

  return { x: Math.floor(xInDrawn / scale), y: Math.floor(yInDrawn / scale) };
}

function pickPixel(img: HTMLImageElement, e: MouseEvent, colorEl: HTMLElement): void {
  const coords = pixelCoordsFromClick(img, e);
  if (!coords) return;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(img, 0, 0);
  const [r, g, b, a] = ctx.getImageData(coords.x, coords.y, 1, 1).data;

  colorEl.innerHTML = '';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  const text = document.createElement('span');
  text.textContent = `(${coords.x}, ${coords.y})  rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})  #${toHex(r)}${toHex(g)}${toHex(b)}`;
  colorEl.append(swatch, text);
}

/** Renders the render-target preview image into `container`, and wires pixel-picking into `colorEl`. */
export function renderPreview(container: HTMLElement, colorEl: HTMLElement, dataUrl: string | null): void {
  container.innerHTML = '';
  colorEl.textContent = 'Click a pixel to inspect its color.';

  if (!dataUrl) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No render target yet.';
    container.appendChild(hint);
    return;
  }

  const img = document.createElement('img');
  img.className = 'preview-image';
  img.src = dataUrl;
  img.addEventListener('click', (e) => pickPixel(img, e, colorEl));
  container.appendChild(img);
}
