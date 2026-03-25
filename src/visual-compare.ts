/**
 * Visual regression: compare screenshot buffer to a baseline image.
 * Requires optional deps: npm install pixelmatch pngjs
 * Use in config: assertScreenshot=baseline.png [threshold=0.1]
 *
 * Modes:
 * - Type 1 (default): Same dimensions required; fail on mismatch.
 * - Type 1 (resize): Set resizeMode: 'actualToBaseline' to resize actual to baseline size then compare (allows different height/width).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CompareResult {
  match: boolean;
  diffPixelCount: number;
  totalPixels: number;
  diffRatio: number;
  /** When dimensions differ (only when resizeMode is not used). */
  dimensionMismatch?: { baseline: { width: number; height: number }; actual: { width: number; height: number } };
  /** True if actual was resized to match baseline dimensions. */
  resized?: boolean;
}

export type CompareScreenshotsOptions = {
  threshold?: number;
  /** 'strict' = fail if dimensions differ (default). 'actualToBaseline' = resize actual to baseline size then compare. */
  resizeMode?: 'strict' | 'actualToBaseline';
};

function loadPngToRgba(filePath: string): { width: number; height: number; data: Uint8Array } {
  const PNG = require('pngjs').PNG;
  const buf = fs.readFileSync(filePath);
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

function decodePngBufferToRgba(buffer: Buffer): { width: number; height: number; data: Uint8Array } {
  const PNG = require('pngjs').PNG;
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/** Resize RGBA buffer (4 bytes per pixel) to target dimensions using bilinear-style sampling. */
function resizeRgba(
  data: Uint8Array,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number
): Uint8Array {
  const out = new Uint8Array(destW * destH * 4);
  for (let y = 0; y < destH; y++) {
    for (let x = 0; x < destW; x++) {
      const sx = ((x + 0.5) / destW) * srcW - 0.5;
      const sy = ((y + 0.5) / destH) * srcH - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i = (y * destW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = data[(y0 * srcW + x0) * 4 + c];
        const p10 = data[(y0 * srcW + x1) * 4 + c];
        const p01 = data[(y1 * srcW + x0) * 4 + c];
        const p11 = data[(y1 * srcW + x1) * 4 + c];
        out[i + c] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy
        );
      }
    }
  }
  return out;
}

/**
 * Compare an actual screenshot (PNG buffer) to a baseline image file.
 * Type 1 strict: dimensions must match (default).
 * Type 1 resize: set resizeMode: 'actualToBaseline' to resize actual to baseline size then compare (allows different height/width).
 *
 * @param actualPngBuffer - PNG bytes from getScreenshot()
 * @param baselinePath - Path to baseline PNG (relative to cwd or absolute)
 * @param options - threshold 0–1 (default 0.1), resizeMode 'strict' | 'actualToBaseline'
 * @returns CompareResult with match, diffPixelCount, diffRatio
 */
export function compareScreenshots(
  actualPngBuffer: Buffer,
  baselinePath: string,
  options: CompareScreenshotsOptions = {}
): CompareResult {
  let pixelmatch: (img1: Uint8Array, img2: Uint8Array, output: Uint8Array | null, w: number, h: number, opts?: object) => number;
  try {
    pixelmatch = require('pixelmatch');
  } catch {
    throw new Error(
      'Visual comparison requires optional dependencies. Install with: npm install pixelmatch pngjs'
    );
  }

  const resolvedBaseline = path.isAbsolute(baselinePath) ? baselinePath : path.resolve(process.cwd(), baselinePath);
  if (!fs.existsSync(resolvedBaseline)) {
    throw new Error(`Baseline image not found: ${resolvedBaseline}`);
  }

  const baseline = loadPngToRgba(resolvedBaseline);
  let actual = decodePngBufferToRgba(actualPngBuffer);
  let resized = false;

  const resizeMode = options.resizeMode ?? 'strict';
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    if (resizeMode === 'actualToBaseline') {
      actual = {
        width: baseline.width,
        height: baseline.height,
        data: resizeRgba(actual.data, actual.width, actual.height, baseline.width, baseline.height),
      };
      resized = true;
    } else {
      return {
        match: false,
        diffPixelCount: 0,
        totalPixels: actual.width * actual.height,
        diffRatio: 1,
        dimensionMismatch: {
          baseline: { width: baseline.width, height: baseline.height },
          actual: { width: actual.width, height: actual.height },
        },
      };
    }
  }

  const threshold = options.threshold ?? 0.1;
  const totalPixels = baseline.width * baseline.height;
  const diffPixelCount = pixelmatch(baseline.data, actual.data, null, baseline.width, baseline.height, {
    threshold,
    includeAA: true,
  });

  const diffRatio = totalPixels > 0 ? diffPixelCount / totalPixels : 0;
  return {
    match: diffPixelCount === 0,
    diffPixelCount,
    totalPixels,
    diffRatio,
    ...(resized ? { resized: true } : {}),
  };
}
