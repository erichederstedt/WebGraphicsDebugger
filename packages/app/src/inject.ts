import { attachDebugSession, findRedundantCalls } from '@wgd/core';
import { buildThumbnails } from './thumbnails.js';
import baseStyles from './style.css?inline';
import panelStyles from './inject.css?inline';

// Dynamic import: even though this IIFE bundle can't code-split (a single
// <script src> file can't lazily fetch a chunk), this still defers the
// actual WASM compile in imguiApp's init to first capture, not page load.
const loadInspectUI = () => import('./imguiApp.js');

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
          <section class="inspect-pane">
            <div id="inspect-root" class="inspect-root"></div>
          </section>
        </main>
      </div>
    `;

    const appEl = shadow.getElementById('app') as HTMLElement;
    const captureBtn = shadow.getElementById('capture-btn') as HTMLButtonElement;
    const captureStatus = shadow.getElementById('capture-status') as HTMLElement;
    const inspectRootEl = shadow.getElementById('inspect-root') as HTMLElement;

    captureBtn.disabled = true;
    captureStatus.textContent = 'looking for a WebGL2 canvas…';

    let tries = 0;
    const poll = window.setInterval(() => {
      const found = findGLCanvas();
      if (found) {
        window.clearInterval(poll);
        this.wire(found.canvas, found.gl, { appEl, captureBtn, captureStatus, inspectRootEl });
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
      inspectRootEl: HTMLElement;
    },
  ): void {
    const { appEl, captureBtn, captureStatus, inspectRootEl } = els;

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
        const thumbnails = buildThumbnails(gl, session.calls, session.registry);
        captureStatus.textContent = `${session.calls.length} calls captured — app paused`;
        captureBtn.disabled = false;
        appEl.dataset.stage = 'inspect';
        // The imgui UI keeps redrawing on its own persistent rAF loop below —
        // must use realRAF too, since the patched window.rAF is now frozen.
        const redundant = findRedundantCalls(session.calls, session.stateTracker);
        loadInspectUI().then(({ mountInspectUI }) => mountInspectUI(inspectRootEl, session, redundant, thumbnails, { scheduleFrame: realRAF }));
      });
    });
  }
}

declare global {
  interface Window {
    WGD: { Debugger: typeof Debugger };
  }
}
