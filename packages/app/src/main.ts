import { attachDebugSession, findRedundantCalls } from '@wgd/core';
import { createDemoScene } from './demoScene.js';
import { buildThumbnails } from './thumbnails.js';

// Dynamic import: imgui-ts embeds a multi-hundred-KB WASM binary, no reason to
// pay that cost before the user has even captured a frame.
const loadInspectUI = () => import('./imguiApp.js');

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
const captureStatus = document.getElementById('capture-status') as HTMLElement;
const inspectRoot = document.getElementById('inspect-root') as HTMLElement;

const scene = createDemoScene(canvas);

let pendingCapture = false;

captureBtn.addEventListener('click', () => {
  pendingCapture = true;
  captureStatus.textContent = 'capturing next frame…';
});

function frame(t: number) {
  if (pendingCapture) {
    pendingCapture = false;
    const session = attachDebugSession(scene.gl);
    scene.drawFrame(t);
    session.detach();
    const thumbnails = buildThumbnails(scene.gl, session.calls, session.registry);

    captureStatus.textContent = `${session.calls.length} calls captured`;
    app.dataset.stage = 'inspect';
    const redundant = findRedundantCalls(session.calls, session.stateTracker);
    loadInspectUI().then(({ mountInspectUI }) => mountInspectUI(inspectRoot, session, redundant, thumbnails));
  } else {
    scene.drawFrame(t);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
