import { readPsd, Psd, Layer } from 'ag-psd';

export interface ProcessingProgress {
  current: number;
  total: number;
  currentMockup: string;
  currentPoster: string;
}

export interface ProcessingSummary {
  processed: number;
  succeeded: number;
  failed: number;
}

function findDesignLayer(layer: Layer): Layer | null {
  if (layer.name?.toUpperCase() === 'DESIGN_HERE') return layer;
  if (layer.children) {
    for (const child of layer.children) {
      const found = findDesignLayer(child);
      if (found) return found;
    }
  }
  return null;
}

function collectLayerNames(layers: Layer[], depth = 0): string[] {
  const names: string[] = [];
  for (const layer of layers) {
    names.push(`${'  '.repeat(depth)}${layer.name || '(unnamed)'}`);
    if (layer.children) {
      names.push(...collectLayerNames(layer.children, depth + 1));
    }
  }
  return names;
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Extract the 4 corner points of the DESIGN_HERE layer.
 * Uses placedLayer.nonAffineTransform or transform if available,
 * otherwise falls back to layer bounds.
 */
function extractCornerPoints(layer: Layer): [number, number][] {
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const right = layer.right ?? 0;
  const bottom = layer.bottom ?? 0;
  const boundsCorners: [number, number][] = [[left, top], [right, top], [right, bottom], [left, bottom]];
  const boundsArea = Math.abs((right - left) * (bottom - top));

  const pl = (layer as any).placedLayer;
  const tryTransform = (t: number[]): [number, number][] | null => {
    if (!t || !Array.isArray(t) || t.length < 8) return null;
    const corners: [number, number][] = [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]], [t[6], t[7]]];
    
    // Validate: compute area of transform quad using shoelace formula
    const quadArea = Math.abs(
      (corners[0][0] * corners[1][1] - corners[1][0] * corners[0][1]) +
      (corners[1][0] * corners[2][1] - corners[2][0] * corners[1][1]) +
      (corners[2][0] * corners[3][1] - corners[3][0] * corners[2][1]) +
      (corners[3][0] * corners[0][1] - corners[0][0] * corners[3][1])
    ) / 2;

    // Check if centroid of transform corners is near centroid of bounds
    const tcx = corners.reduce((s, c) => s + c[0], 0) / 4;
    const tcy = corners.reduce((s, c) => s + c[1], 0) / 4;
    const bcx = (left + right) / 2;
    const bcy = (top + bottom) / 2;
    const dist = Math.sqrt((tcx - bcx) ** 2 + (tcy - bcy) ** 2);
    const boundsSize = Math.sqrt(boundsArea) || 1;

    // Reject if area ratio is too extreme or centroid is too far from bounds
    if (boundsArea > 0 && (quadArea > boundsArea * 3 || quadArea < boundsArea * 0.1)) {
      console.warn('Transform area mismatch, using bounds. Transform area:', quadArea, 'Bounds area:', boundsArea);
      return null;
    }
    if (dist > boundsSize * 1.5) {
      console.warn('Transform centroid too far from bounds, using bounds. Dist:', dist);
      return null;
    }

    return corners;
  };

  if (pl?.nonAffineTransform) {
    const result = tryTransform(pl.nonAffineTransform);
    if (result) return result;
  }
  if (pl?.transform) {
    const result = tryTransform(pl.transform);
    if (result) return result;
  }

  return boundsCorners;
}

/**
 * Expand corners outward by `px` pixels from centroid.
 */
function expandCorners(corners: [number, number][], px: number): [number, number][] {
  const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const cy = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  return corners.map(c => {
    const dx = c[0] - cx;
    const dy = c[1] - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [c[0] + dx / len * px, c[1] + dy / len * px] as [number, number];
  });
}

/**
 * Draw a textured triangle using affine transform.
 * Maps source triangle (s0,s1,s2) from srcCanvas to destination triangle (d0,d1,d2) on ctx.
 */
function expandTriangle(
  d0: [number, number], d1: [number, number], d2: [number, number], px: number
): [[number, number], [number, number], [number, number]] {
  const cx = (d0[0] + d1[0] + d2[0]) / 3;
  const cy = (d0[1] + d1[1] + d2[1]) / 3;
  const expand = (p: [number, number]): [number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [p[0] + (dx / len) * px, p[1] + (dy / len) * px];
  };
  return [expand(d0), expand(d1), expand(d2)];
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement | HTMLImageElement,
  srcW: number, srcH: number,
  s0: [number, number], s1: [number, number], s2: [number, number],
  d0: [number, number], d1: [number, number], d2: [number, number]
) {
  // Expand clip triangle by 1px to eliminate seams between adjacent triangles
  const [ed0, ed1, ed2] = expandTriangle(d0, d1, d2, 1.0);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ed0[0], ed0[1]);
  ctx.lineTo(ed1[0], ed1[1]);
  ctx.lineTo(ed2[0], ed2[1]);
  ctx.closePath();
  ctx.clip();

  // Solve affine transform: src → dst (using original non-expanded points for correct mapping)
  const x0 = s0[0], y0 = s0[1];
  const x1 = s1[0], y1 = s1[1];
  const x2 = s2[0], y2 = s2[1];
  const u0 = d0[0], v0 = d0[1];
  const u1 = d1[0], v1 = d1[1];
  const u2 = d2[0], v2 = d2[1];

  const det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(det) < 1e-6) { ctx.restore(); return; }

  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / det;
  const b = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / det;
  const c = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / det;
  const d = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / det;
  const e = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / det;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / det;

  ctx.setTransform(a, d, b, e, c, f);
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.restore();
}

/**
 * Draw a quad-mapped image using triangulation (perspective approximation).
 * Splits the quad into a grid of sub-quads for better perspective accuracy.
 */
function drawPerspectiveImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | HTMLImageElement,
  imgW: number, imgH: number,
  tl: [number, number], tr: [number, number],
  br: [number, number], bl: [number, number],
  subdivisions: number = 20
) {
  const n = subdivisions;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const u0 = ix / n, u1 = (ix + 1) / n;
      const v0 = iy / n, v1 = (iy + 1) / n;

      // Bilinear interpolation for destination corners
      const lerp = (a: [number, number], b: [number, number], t: number): [number, number] =>
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

      const topL = lerp(lerp(tl, tr, u0), lerp(bl, br, u0), v0);
      const topR = lerp(lerp(tl, tr, u1), lerp(bl, br, u1), v0);
      const botR = lerp(lerp(tl, tr, u1), lerp(bl, br, u1), v1);
      const botL = lerp(lerp(tl, tr, u0), lerp(bl, br, u0), v1);

      // Source coordinates
      const sx0 = u0 * imgW, sx1 = u1 * imgW;
      const sy0 = v0 * imgH, sy1 = v1 * imgH;

      // Two triangles per sub-quad
      drawTexturedTriangle(ctx, img, imgW, imgH,
        [sx0, sy0], [sx1, sy0], [sx1, sy1],
        topL, topR, botR
      );
      drawTexturedTriangle(ctx, img, imgW, imgH,
        [sx0, sy0], [sx1, sy1], [sx0, sy1],
        topL, botR, botL
      );
    }
  }
}

export async function readPsdFile(file: File): Promise<Psd> {
  const buffer = await file.arrayBuffer();
  return readPsd(new Uint8Array(buffer), { skipCompositeImageData: false, skipLayerImageData: false });
}

/**
 * Erzeugt kurze, sichere Dateinamen ohne Sonderzeichen (für ZIP-Entpackung).
 */
function sanitizeFileName(name: string, maxLength: number = 40): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Diakritika entfernen (é→e, ü→u)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLength) || 'img';
  return normalized || 'img';
}

export function getPsdHasDesignLayer(psd: Psd): boolean {
  if (!psd.children) return false;
  for (const child of psd.children) {
    if (findDesignLayer(child)) return true;
  }
  return false;
}

export async function compositeImage(
  psdFile: File,
  posterFile: File,
  quality: number = 0.92,
  shrinkPx: number = 2
): Promise<Blob> {
  const buffer = await psdFile.arrayBuffer();
  const psd = readPsd(new Uint8Array(buffer), { skipCompositeImageData: false, skipLayerImageData: false });

  // Find DESIGN_HERE layer
  let designLayer: Layer | null = null;
  if (psd.children) {
    for (const child of psd.children) {
      designLayer = findDesignLayer(child);
      if (designLayer) break;
    }
  }

  if (!designLayer) {
    const layerNames = collectLayerNames(psd.children || []);
    throw new Error(
      `Keine 'DESIGN_HERE'-Ebene in ${psdFile.name} gefunden.\n` +
      `Gefundene Ebenen:\n${layerNames.join('\n')}\n\n` +
      `Bitte benenne die Ziel-Ebene in deiner PSD exakt in 'DESIGN_HERE' um.`
    );
  }

  // Extract corner points (supports perspective via placedLayer)
  const corners = extractCornerPoints(designLayer);
  // Shrink corners inward so the poster sits behind the frame, not on top
  const shrunk = expandCorners(corners, -shrinkPx);
  const [etl, etr, ebr, ebl] = shrunk;

  console.log('Design corners:', corners.map(c => `(${Math.round(c[0])},${Math.round(c[1])})`).join(' '));

  // Load poster image
  const posterUrl = URL.createObjectURL(posterFile);
  const posterImg = await loadImageFromUrl(posterUrl);
  URL.revokeObjectURL(posterUrl);

  const psdW = psd.width;
  const psdH = psd.height;

  if (!psd.canvas) {
    throw new Error('PSD hat kein Composite-Bild. Bitte speichere die PSD mit "Kompatibilität maximieren".');
  }

  // === Step 1: Create base = full composite with design area filled white ===
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = psdW;
  baseCanvas.height = psdH;
  const baseCtx = baseCanvas.getContext('2d')!;
  baseCtx.drawImage(psd.canvas, 0, 0);

  // Fill the expanded design polygon with white
  baseCtx.fillStyle = 'white';
  baseCtx.beginPath();
  baseCtx.moveTo(etl[0], etl[1]);
  baseCtx.lineTo(etr[0], etr[1]);
  baseCtx.lineTo(ebr[0], ebr[1]);
  baseCtx.lineTo(ebl[0], ebl[1]);
  baseCtx.closePath();
  baseCtx.fill();

  // === Step 2: Create perspective-distorted poster clipped to design area ===
  const posterCanvas = document.createElement('canvas');
  posterCanvas.width = psdW;
  posterCanvas.height = psdH;
  const posterCtx = posterCanvas.getContext('2d')!;

  // Draw poster with perspective mapping into the expanded corners
  drawPerspectiveImage(
    posterCtx, posterImg,
    posterImg.width, posterImg.height,
    etl, etr, ebr, ebl
  );

  // === Step 3: Composite: base + poster + full composite (Multiply for shadows) ===
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = psdW;
  outputCanvas.height = psdH;
  const ctx = outputCanvas.getContext('2d')!;

  // Draw base (composite with white design area)
  ctx.drawImage(baseCanvas, 0, 0);

  // Draw distorted poster on top
  ctx.drawImage(posterCanvas, 0, 0);

  // Draw original full composite with Multiply blend mode (for shadows, frames, etc.)
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(psd.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // Export as JPEG
  return new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to export JPEG'));
      },
      'image/jpeg',
      quality
    );
  });
}

export async function processAllCombinations(
  psdFiles: File[],
  posterFiles: File[],
  onProgress: (progress: ProcessingProgress) => void,
  onPosterStart: (posterName: string, posterFile: File) => Promise<void> | void,
  onPosterDone: (posterName: string, posterFile: File) => Promise<void> | void,
  onResult: (outputName: string, blob: Blob) => Promise<void> | void,
  quality: number = 0.92,
  shrinkPx: number = 2
): Promise<ProcessingSummary> {
  const total = psdFiles.length * posterFiles.length;
  let current = 0;
  let succeeded = 0;
  let failed = 0;

  // Group by poster: each poster gets a folder, mockups are numbered
  for (const posterFile of posterFiles) {
    const posterName = posterFile.name.replace(/\.(jpe?g|png|webp)$/i, '');
    const safeName = sanitizeFileName(posterName);
    await onPosterStart(posterName, posterFile);
    let mockupIndex = 1;
    for (const psdFile of psdFiles) {
      const outputName = psdFiles.length === 1
        ? `${safeName}/${safeName}.jpg`
        : `${safeName}/${safeName}_${mockupIndex}.jpg`;

      onProgress({
        current,
        total,
        currentMockup: psdFile.name,
        currentPoster: posterFile.name,
      });

      try {
        const blob = await compositeImage(psdFile, posterFile, quality, shrinkPx);
        await onResult(outputName, blob);
        succeeded++;
      } catch (err) {
        console.error(`Error processing ${outputName}:`, err);
        failed++;
      }

      current++;
      mockupIndex++;
      onProgress({
        current,
        total,
        currentMockup: psdFile.name,
        currentPoster: posterFile.name,
      });
    }
    await onPosterDone(posterName, posterFile);
  }

  return { processed: total, succeeded, failed };
}
