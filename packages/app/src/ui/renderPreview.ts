export function renderPreview(container: HTMLElement, dataUrl: string | null): void {
  container.innerHTML = '';
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
  container.appendChild(img);
}
