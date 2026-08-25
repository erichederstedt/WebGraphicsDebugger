import { attachDebugSession, findRedundantCalls, type DebugSession } from '@wgd/core';
import { CallListView } from './ui/callList.js';
import { renderStatePanel } from './ui/statePanel.js';
import { renderPreview } from './ui/renderPreview.js';
import { buildThumbnails, type ThumbnailTrack } from './thumbnails.js';
import baseStyles from './style.css?inline';
import panelStyles from './inject.css?inline';

// style.css scopes its variables on :root, which never matches inside a shadow
// tree (there is no shadow-root equivalent) — retarget them at :host instead.
const CSS = baseStyles.replace(':root', ':host') + panelStyles;

const CANVAS_POLL_MS = 500;
const CANVAS_POLL_MAX_TRIES = 20; // ~10s, covers canvases created shortly after injection

// Most WebGL apps drive their whole loop (animation, physics, draw calls) off
// requestAnimationFrame, so freezing it after a capture pauses the app. We
// keep our own reference to the real rAF so the capture-wait below still
// ticks even once the patched one starts swallowing calls.
const realRAF = window.requestAnimationFrame.bind(window);
let paused = false;
let rafPatched = false;

function patchRAF(): void {
  if (rafPatched) return;
  rafPatched = true;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => (paused ? 0 : realRAF(cb));
}

function findGLCanvas(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
    const gl = canvas.getContext('webgl2');
    if (gl) return { canvas, gl };
  }
  return null;
}

/** Drop-in equivalent of `new SPECTOR.Spector(); .displayUI()`. */
export class Debugger {
  private host: HTMLElement | null = null;

  displayUI(): void {
    if (this.host) return;
    patchRAF();

    const host = document.createElement('div');
    host.style.all = 'initial';
    document.body.appendChild(host);
    this.host = host;

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <div id="app" class="wgd-panel" data-stage="capture">
        <header class="topbar">
          <div class="topbar-controls">
            <button id="capture-btn">Capture Frame</button>
            <span id="capture-status"></span>
          </div>
        </header>
        <main class="layout">
          <section class="call-list-pane">
            <h2>Call List</h2>
            <div id="call-list" class="call-list"></div>
          </section>
          <section class="state-pane">
            <div class="preview-pane">
              <h2>Render Target</h2>
              <div id="render-preview" class="preview-body"></div>
              <div id="pixel-color" class="pixel-color"></div>
            </div>
            <div class="state-block">
              <h2>GL State</h2>
              <div id="state-panel" class="state-panel"></div>
            </div>
          </section>
        </main>
      </div>
    `;

    const appEl = shadow.getElementById('app') as HTMLElement;
    const captureBtn = shadow.getElementById('capture-btn') as HTMLButtonElement;
    const captureStatus = shadow.getElementById('capture-status') as HTMLElement;
    const callListEl = shadow.getElementById('call-list') as HTMLElement;
    const statePanelEl = shadow.getElementById('state-panel') as HTMLElement;
    const previewEl = shadow.getElementById('render-preview') as HTMLElement;
    const pixelColorEl = shadow.getElementById('pixel-color') as HTMLElement;

    captureBtn.disabled = true;
    captureStatus.textContent = 'looking for a WebGL2 canvas…';

    let tries = 0;
    const poll = window.setInterval(() => {
      const found = findGLCanvas();
      if (found) {
        window.clearInterval(poll);
        this.wire(found.canvas, found.gl, { appEl, captureBtn, captureStatus, callListEl, statePanelEl, previewEl, pixelColorEl });
      } else if (++tries >= CANVAS_POLL_MAX_TRIES) {
        window.clearInterval(poll);
        captureStatus.textContent = 'no WebGL2 canvas found on this page';
      }
    }, CANVAS_POLL_MS);
  }

  private wire(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    els: {
      appEl: HTMLElement;
      captureBtn: HTMLButtonElement;
      captureStatus: HTMLElement;
      callListEl: HTMLElement;
      statePanelEl: HTMLElement;
      previewEl: HTMLElement;
      pixelColorEl: HTMLElement;
    },
  ): void {
    const { appEl, captureBtn, captureStatus, callListEl, statePanelEl, previewEl, pixelColorEl } = els;
    let currentSession: DebugSession | null = null;
    let thumbnails: ThumbnailTrack | null = null;

    const callListView = new CallListView(callListEl, (index) => {
      if (!currentSession) return;
      renderStatePanel(statePanelEl, currentSession.getStateAt(index));
      renderPreview(previewEl, pixelColorEl, thumbnails?.thumbnailAt(index) ?? null);
    });
    callListView.render([]);

    captureBtn.disabled = false;
    captureStatus.textContent = '';

    captureBtn.addEventListener('click', () => {
      captureBtn.disabled = true;
      captureStatus.textContent = 'capturing next frame…';
      const session = attachDebugSession(gl);

      // Wait for the host page's next rAF pass — since attach happens outside
      // any rAF callback, its already-queued frame callback runs before ours,
      // capturing exactly the one frame it draws. Uses the real rAF directly
      // since the patched window.rAF stops firing once `paused` flips, which
      // happens right after this completes.
      realRAF(() => {
        session.detach();
        paused = true;
        canvas.style.visibility = 'hidden'; // it's a frozen, non-interactive frame now
        currentSession = session;
        thumbnails = buildThumbnails(gl, session.calls, session.registry);
        callListView.render(session.calls, findRedundantCalls(session.calls, session.stateTracker));
        const lastIndex = session.calls.length - 1;
        if (lastIndex >= 0) callListView.select(lastIndex);
        captureStatus.textContent = `${session.calls.length} calls captured — app paused`;
        captureBtn.disabled = false;
        appEl.dataset.stage = 'inspect';
      });
    });
  }
}

declare global {
  interface Window {
    WGD: { Debugger: typeof Debugger };
  }
}
