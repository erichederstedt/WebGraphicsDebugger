import { replayCalls, type GLCall, type ObjectRegistry } from '@wgd/core';

export interface FrameSnapshot {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  pixelAt(x: number, y: number): readonly [number, number, number, number];
}

function makeSnapshot(pixels: Uint8ClampedArray, width: number, height: number): FrameSnapshot {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);

  return {
    canvas,
    width,
    height,
    pixelAt(x, y) {
      const i = (y * width + x) * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    },
  };
}

/**
 * Replays the frame up to and including `targetCallId` against the still-live
 * (paused) `gl` context and reads back whatever's in the framebuffer at that
 * point. Done fresh per call rather than baked for the whole frame up front,
 * so cost scales with whatever's actually being looked at, not every draw in
 * the capture — the caller is expected to cache this by call id and only
 * call again when the selection actually changes.
 */
export function snapshotForCall(gl: WebGL2RenderingContext, calls: readonly GLCall[], registry: ObjectRegistry, targetCallId: number): FrameSnapshot | null {
  if (calls.length === 0 || targetCallId < 0) return null;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width === 0 || height === 0) return null;

  replayCalls(gl, calls, registry, targetCallId);

  const readBuf = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, readBuf);
  const rowBytes = width * 4;
  const flipped = new Uint8ClampedArray(readBuf.length);
  for (let y = 0; y < height; y++) {
    const srcStart = (height - y - 1) * rowBytes; // GL rows are bottom-up, canvas rows are top-down
    flipped.set(readBuf.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
  }
  return makeSnapshot(flipped, width, height);
}
