import { replayCalls, type GLCall, type ObjectRegistry } from '@wgd/core';

export interface FrameSnapshot {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  pixelAt(x: number, y: number): readonly [number, number, number, number];
}

export interface ThumbnailTrack {
  /** Render target right after calls[callId] (or the nearest prior snapshot); null before the first draw. */
  snapshotAt(callId: number): FrameSnapshot | null;
}

const NO_THUMBNAILS: ThumbnailTrack = { snapshotAt: () => null };

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
 * Replays a captured frame against the still-live (paused) `gl` context and
 * snapshots the framebuffer after every draw/clear, so the call list can show
 * "what did the render target look like at this point" like Spector/RenderDoc.
 */
export function buildThumbnails(gl: WebGL2RenderingContext, calls: readonly GLCall[], registry: ObjectRegistry): ThumbnailTrack {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width === 0 || height === 0) return NO_THUMBNAILS;

  const readBuf = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  const snapshotById = new Map<number, FrameSnapshot>();

  replayCalls(gl, calls, registry, (call) => {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, readBuf);
    const flipped = new Uint8ClampedArray(readBuf.length);
    for (let y = 0; y < height; y++) {
      const srcStart = (height - y - 1) * rowBytes; // GL rows are bottom-up, canvas rows are top-down
      flipped.set(readBuf.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
    }
    snapshotById.set(call.id, makeSnapshot(flipped, width, height));
  });

  let carry: FrameSnapshot | null = null;
  const filled = new Map<number, FrameSnapshot | null>();
  for (const call of calls) {
    if (snapshotById.has(call.id)) carry = snapshotById.get(call.id)!;
    filled.set(call.id, carry);
  }

  return { snapshotAt: (callId) => filled.get(callId) ?? null };
}
