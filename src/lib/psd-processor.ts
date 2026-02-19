import { readPsd, writePsd, Psd, Layer } from 'ag-psd';

export interface ProcessingProgress {
  current: number;
  total: number;
  currentMockup: string;
  currentPoster: string;
}

function findDesignLayer(layer: Layer): Layer | null {
  if (layer.name === 'DESIGN_HERE') return layer;
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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new HTMLImageElement();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function coverFit(
  srcW: number, srcH: number,
  targetW: number, targetH: number
): { sx: number; sy: number; sw: number; sh: number } {
  const srcRatio = srcW / srcH;
  const targetRatio = targetW / targetH;

  if (srcRatio > targetRatio) {
    const sw = srcH * targetRatio;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  } else {
    const sh = srcW / targetRatio;
    return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
  }
}

export async function readPsdFile(file: File): Promise<Psd> {
  const buffer = await file.arrayBuffer();
  return readPsd(new Uint8Array(buffer), { skipCompositeImageData: false, skipLayerImageData: false });
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
  quality: number = 0.92
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

  // Get layer bounds
  const layerLeft = designLayer.left ?? 0;
  const layerTop = designLayer.top ?? 0;
  const layerWidth = (designLayer.right ?? psd.width) - layerLeft;
  const layerHeight = (designLayer.bottom ?? psd.height) - layerTop;

  // Load poster image
  const posterUrl = URL.createObjectURL(posterFile);
  const posterImg = await loadImageFromUrl(posterUrl);
  URL.revokeObjectURL(posterUrl);

  // Create poster canvas scaled to layer size (cover fit)
  const posterCanvas = document.createElement('canvas');
  posterCanvas.width = layerWidth;
  posterCanvas.height = layerHeight;
  const posterCtx = posterCanvas.getContext('2d')!;
  const crop = coverFit(posterImg.width, posterImg.height, layerWidth, layerHeight);
  posterCtx.drawImage(posterImg, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, layerWidth, layerHeight);

  // Replace the DESIGN_HERE layer's canvas with our poster
  designLayer.canvas = posterCanvas;

  // Write the modified PSD back – ag-psd regenerates the composite image
  const modifiedPsdBuffer = writePsd(psd);

  // Read the modified PSD to get the new flattened composite
  const modifiedPsd = readPsd(modifiedPsdBuffer, { skipCompositeImageData: false, skipLayerImageData: true });

  // Draw composite to output canvas
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = modifiedPsd.width;
  outputCanvas.height = modifiedPsd.height;
  const ctx = outputCanvas.getContext('2d')!;

  if (modifiedPsd.canvas) {
    ctx.drawImage(modifiedPsd.canvas, 0, 0);
  } else {
    throw new Error('Konnte kein Composite-Bild aus der modifizierten PSD generieren.');
  }

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
  quality: number = 0.92
): Promise<Map<string, Blob>> {
  const results = new Map<string, Blob>();
  const total = psdFiles.length * posterFiles.length;
  let current = 0;

  for (const psdFile of psdFiles) {
    for (const posterFile of posterFiles) {
      const psdName = psdFile.name.replace(/\.psd$/i, '');
      const posterName = posterFile.name.replace(/\.(jpe?g|png|webp)$/i, '');
      const outputName = `${psdName}_${posterName}.jpg`;

      onProgress({
        current,
        total,
        currentMockup: psdFile.name,
        currentPoster: posterFile.name,
      });

      try {
        const blob = await compositeImage(psdFile, posterFile, quality);
        results.set(outputName, blob);
      } catch (err) {
        console.error(`Error processing ${outputName}:`, err);
      }

      current++;
      onProgress({
        current,
        total,
        currentMockup: psdFile.name,
        currentPoster: posterFile.name,
      });
    }
  }

  return results;
}
