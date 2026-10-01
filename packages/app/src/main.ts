import { attachDebugSession, findRedundantCalls } from '@wgd/core';
import { createDemoScene, type DemoScene } from './demoScene.js';
import { createCubeScene } from './cubeScene.js';
import { loadObjFiles, loadObjScene } from './objScene.js';

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
let loading = false;
let selectedScene = 'triangle';
let localFiles: File[] = [];
let loadController: AbortController | null = null;
const objFiles = document.getElementById('obj-files') as HTMLInputElement;
const sceneStatus = document.getElementById('scene-status') as HTMLElement;

async function selectScene(name: string): Promise<void> {
  const version = ++captureVersion;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  pendingCapture = false;
  loading = true;
  captureBtn.disabled = true;
  captureStatus.textContent = '';
  app.dataset.stage = 'capture';
  scene.dispose?.();
  scene = scenes.get('triangle')!;
  sceneStatus.textContent = name === 'sponza' || name === 'sibenik' || name === 'local' ? 'Loading OBJ scene…' : '';
  try {
    let nextScene = scenes.get(name);
    if (!nextScene) {
      if (name === 'sponza') nextScene = await loadObjScene(canvas, `${import.meta.env.BASE_URL}scenes/sponza/sponza.obj`, controller.signal, {
        target: [0, 3, 0], distance: 7, yaw: -Math.PI / 2, pitch: 0.08,
      });
      else if (name === 'sibenik') nextScene = await loadObjScene(canvas, `${import.meta.env.BASE_URL}scenes/sibenik/sibenik.obj`, controller.signal, {
        target: [0, -10, 0], distance: 12, yaw: Math.PI / 2, pitch: -0.08,
      });
      else if (name === 'local') nextScene = await loadObjFiles(canvas, localFiles, controller.signal);
      else {
        nextScene = createCubeScene(canvas);
        scenes.set(name, nextScene);
      }
    }
    if (version !== captureVersion) { nextScene.dispose?.(); return; }
    scene = nextScene;
    selectedScene = name;
    sceneSelect.value = name;
    sceneStatus.textContent = name === 'sponza' || name === 'sibenik' || name === 'local' ? 'Drag to orbit · Scroll to zoom · Capture Frame to inspect' : '';
  } catch (error) {
    if (version !== captureVersion) return;
    selectedScene = 'triangle';
    sceneSelect.value = selectedScene;
    sceneStatus.textContent = `Could not load scene: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (version === captureVersion) {
      loading = false;
      captureBtn.disabled = false;
    }
  }
}

sceneSelect.addEventListener('change', () => {
  if (sceneSelect.value === 'open-obj') {
    sceneSelect.value = selectedScene;
    objFiles.click();
  } else {
    void selectScene(sceneSelect.value);
  }
});

objFiles.addEventListener('change', () => {
  if (!objFiles.files?.length) return;
  localFiles = Array.from(objFiles.files);
  let option = sceneSelect.querySelector<HTMLOptionElement>('option[value="local"]');
  if (!option) {
    option = document.createElement('option');
    option.value = 'local';
    sceneSelect.add(option);
  }
  option.textContent = localFiles.find(file => /\.obj$/i.test(file.name))?.name ?? 'Local OBJ';
  objFiles.value = '';
  void selectScene('local');
});

captureBtn.addEventListener('click', () => {
  if (loading) return;
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
  } else if (!loading && app.dataset.stage === 'capture') {
    scene.drawFrame(t);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
