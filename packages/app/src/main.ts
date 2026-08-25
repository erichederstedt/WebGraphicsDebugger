import { attachDebugSession, createInitialState, findRedundantCalls, type DebugSession } from '@wgd/core';
import { createDemoScene } from './demoScene.js';
import { CallListView } from './ui/callList.js';
import { renderStatePanel } from './ui/statePanel.js';
import { renderPreview } from './ui/renderPreview.js';
import { buildThumbnails, type ThumbnailTrack } from './thumbnails.js';

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
const captureStatus = document.getElementById('capture-status') as HTMLElement;
const callListEl = document.getElementById('call-list') as HTMLElement;
const statePanelEl = document.getElementById('state-panel') as HTMLElement;
const previewEl = document.getElementById('render-preview') as HTMLElement;

const scene = createDemoScene(canvas);

let currentSession: DebugSession | null = null;
let thumbnails: ThumbnailTrack | null = null;

const callListView = new CallListView(callListEl, (index) => {
  if (!currentSession) return;
  renderStatePanel(statePanelEl, currentSession.getStateAt(index));
  renderPreview(previewEl, thumbnails?.thumbnailAt(index) ?? null);
});

callListView.render([]);
renderStatePanel(statePanelEl, createInitialState());

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
    currentSession = session;
    thumbnails = buildThumbnails(scene.gl, session.calls, session.registry);

    callListView.render(session.calls, findRedundantCalls(session.calls, session.stateTracker));
    const lastIndex = session.calls.length - 1;
    if (lastIndex >= 0) callListView.select(lastIndex);
    captureStatus.textContent = `${session.calls.length} calls captured`;
    app.dataset.stage = 'inspect';
  } else {
    scene.drawFrame(t);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
