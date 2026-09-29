import { attachDebugSession, findRedundantCalls } from '@wgd/core';
import { createDemoScene, type DemoScene } from './demoScene.js';
import { createCubeScene } from './cubeScene.js';

// Dynamic import: imgui-ts embeds a multi-hundred-KB WASM binary, no reason to
// pay that cost before the user has even captured a frame.
const loadInspectUI = () => import('./imguiApp.js');

const app = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
const captureBtn = document.getElementById('capture-btn') as HTMLButtonElement;
const captureStatus = document.getElementById('capture-status') as HTMLElement;
const inspectRoot = document.getElementById('inspect-root') as HTMLElement;

const sceneSelect = document.getElementById('scene-select') as HTMLSelectElement;
const scenes = new Map<string, DemoScene>();
let scene = createDemoScene(canvas);
scenes.set('triangle', scene);
let captureVersion = 0;

let pendingCapture = false;

sceneSelect.addEventListener('change', () => {
  const name = sceneSelect.value;
  let nextScene = scenes.get(name);
  if (!nextScene) {
    nextScene = name === 'cube' ? createCubeScene(canvas) : createDemoScene(canvas);
    scenes.set(name, nextScene);
  }
  scene = nextScene;
  pendingCapture = false;
  captureVersion++;
  captureStatus.textContent = '';
  app.dataset.stage = 'capture';
});

captureBtn.addEventListener('click', () => {
  pendingCapture = true;
  captureStatus.textContent = 'capturing next frame…';
});

function frame(t: number) {
  if (pendingCapture) {
    pendingCapture = false;
    const version = ++captureVersion;
    const capturedScene = scene;
    const session = attachDebugSession(capturedScene.gl);
    scene.drawFrame(t);
    session.detach();

    captureStatus.textContent = `${session.calls.length} calls captured`;
    app.dataset.stage = 'inspect';
    const redundant = findRedundantCalls(session.calls, session.stateTracker);
    loadInspectUI().then(({ mountInspectUI }) => {
      if (version === captureVersion) mountInspectUI(inspectRoot, capturedScene.gl, session, redundant);
    });
  } else if (app.dataset.stage === 'capture') {
    scene.drawFrame(t);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
