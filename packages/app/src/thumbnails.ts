import { replayCalls, type GLCall, type ObjectRegistry } from '@wgd/core';

export interface ThumbnailTrack {
  /** Render target as a data URL right after calls[callId] (or the nearest prior snapshot); null before the first draw. */
  thumbnailAt(callId: number): string | null;
}

const NO_THUMBNAILS: ThumbnailTrack = { thumbnailAt: () => null };

/**
 * Replays a captured frame against the still-live (paused) `gl` context and
 * snapshots the framebuffer after every draw/clear, so the call list can show
 * "what did the render target look like at this point" like Spector/RenderDoc.
 */
export function buildThumbnails(gl: WebGL2RenderingContext, calls: readonly GLCall[], registry: ObjectRegistry): ThumbnailTrack {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width === 0 || height === 0) return NO_THUMBNAILS;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return NO_THUMBNAILS;

  const pixels = new Uint8Array(width * height * 4);
  const imageData = ctx2d.createImageData(width, height);
  const rowBytes = width * 4;
  const snapshotById = new Map<number, string>();

  // ponytail: one full-res PNG per snapshot; downscale or reuse ImageBitmaps if heavy scenes make this slow.
  replayCalls(gl, calls, registry, (call) => {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (let y = 0; y < height; y++) {
      const srcStart = (height - y - 1) * rowBytes; // GL rows are bottom-up, canvas rows are top-down
      imageData.data.set(pixels.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
    }
    ctx2d.putImageData(imageData, 0, 0);
    snapshotById.set(call.id, canvas.toDataURL('image/png'));
  });

  let carry: string | null = null;
  const filled = new Map<number, string | null>();
  for (const call of calls) {
    if (snapshotById.has(call.id)) carry = snapshotById.get(call.id)!;
    filled.set(call.id, carry);
  }

  return { thumbnailAt: (callId) => filled.get(callId) ?? null };
}
