import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageTracer = require('imagetracerjs/imagetracer_v1.2.6.js');

type TraceMode = 'icon' | 'detailed' | 'poster';

interface ConvertOptions {
  mode: TraceMode;
  removeBg: boolean;
  bgColorTolerance: number;
  numberOfColors: number;
  scale: number;
  strokeWidth: number;
  blurRadius: number;
  pathOmit: number;
  ltres: number;
  qtres: number;
  roundcoords: number;
  turdSize: number;
  alphaMax: number;
  optCurve: boolean;
  cornerThreshold: number;
}

function detectBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): { r: number; g: number; b: number } {
  const samples: { r: number; g: number; b: number }[] = [];
  const borderWidth = Math.max(5, Math.floor(Math.min(width, height) * 0.05));

  // Sample the full border strip
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder =
        y < borderWidth ||
        y >= height - borderWidth ||
        x < borderWidth ||
        x >= width - borderWidth;
      if (!isBorder) continue;

      const idx = (y * width + x) * channels;
      if (channels === 4 && data[idx + 3] < 128) continue; // Skip transparent
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  if (samples.length === 0) return { r: 255, g: 255, b: 255 };

  // Cluster colors with larger buckets
  const colorCounts = new Map<string, { r: number; g: number; b: number; count: number }>();
  const bucketSize = 24;

  for (const sample of samples) {
    const br = Math.floor(sample.r / bucketSize) * bucketSize;
    const bg = Math.floor(sample.g / bucketSize) * bucketSize;
    const bb = Math.floor(sample.b / bucketSize) * bucketSize;
    const key = `${br},${bg},${bb}`;

    const existing = colorCounts.get(key);
    if (existing) {
      existing.r += sample.r;
      existing.g += sample.g;
      existing.b += sample.b;
      existing.count += 1;
    } else {
      colorCounts.set(key, { r: sample.r, g: sample.g, b: sample.b, count: 1 });
    }
  }

  let maxCount = 0;
  let dominantColor = { r: 255, g: 255, b: 255 };

  for (const entry of colorCounts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      dominantColor = {
        r: Math.round(entry.r / entry.count),
        g: Math.round(entry.g / entry.count),
        b: Math.round(entry.b / entry.count),
      };
    }
  }

  return dominantColor;
}

function removeBackground(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  bgColor: { r: number; g: number; b: number },
  tolerance: number
): Buffer {
  const result = Buffer.alloc(width * height * 4);
  const threshold = tolerance * 441.67; // Max possible Euclidean distance in RGB

  // Use flood-fill from borders for more accurate background detection
  const visited = new Uint8Array(width * height);
  const queue: [number, number][] = [];

  // Seed from all border pixels that match background color
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder =
        y === 0 || y === height - 1 || x === 0 || x === width - 1;
      if (!isBorder) continue;

      const idx = (y * width + x) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = channels === 4 ? data[idx + 3] : 255;

      if (a < 128) continue;

      const dist = Math.sqrt(
        (r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2
      );

      if (dist < threshold) {
        const vi = y * width + x;
        if (!visited[vi]) {
          visited[vi] = 1;
          queue.push([x, y]);
        }
      }
    }
  }

  // Flood fill
  const dx = [0, 0, 1, -1];
  const dy = [1, -1, 0, 0];
  let head = 0;

  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const ci = (cy * width + cx) * channels;

    // Mark as background (transparent)
    const oi = (cy * width + cx) * 4;
    result[oi] = 0;
    result[oi + 1] = 0;
    result[oi + 2] = 0;
    result[oi + 3] = 0;

    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const ni = ny * width + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;

      const pi = ni * channels;
      const r = data[pi];
      const g = data[pi + 1];
      const b = data[pi + 2];
      const a = channels === 4 ? data[pi + 3] : 255;

      if (a < 128) {
        // Transparent pixel = background
        queue.push([nx, ny]);
        continue;
      }

      const dist = Math.sqrt(
        (r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2
      );

      if (dist < threshold * 1.2) {
        // Slightly relaxed threshold for flood fill to capture anti-aliased edges
        queue.push([nx, ny]);
      }
    }
  }

  // Fill non-background pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const vi = y * width + x;
      const oi = vi * 4;

      if (visited[vi]) {
        // Already marked as background
        continue;
      }

      const pi = vi * channels;
      result[oi] = data[pi];
      result[oi + 1] = data[pi + 1];
      result[oi + 2] = data[pi + 2];
      result[oi + 3] = channels === 4 ? data[pi + 3] : 255;
    }
  }

  return result;
}

function postProcessSvg(svgString: string, width: number, height: number): string {
  // Remove desc attribute
  let svg = svgString.replace(/\s*desc="[^"]*"/, '');

  // Add width and height
  svg = svg.replace(
    /<svg\s/,
    `<svg width="${width}" height="${height}" `
  );

  // Remove opacity="1" (redundant)
  svg = svg.replace(/\s+opacity="1"/g, '');

  // Remove stroke when same as fill and stroke-width="1" (redundant for filled paths)
  svg = svg.replace(/\s+stroke="rgb\(([^"]+)\)"\s+stroke-width="1"/g, (match, color) => {
    // Keep stroke if it differs from fill
    const fillMatch = svg.substring(svg.indexOf(match) - 100, svg.indexOf(match) + match.length).match(/fill="rgb\(([^"]+)\)"/);
    if (fillMatch && fillMatch[1] === color) {
      return '';
    }
    return match;
  });

  return svg;
}

function potraceAsync(
  pngBuffer: Buffer,
  options: Record<string, unknown>
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const potraceMod = require('potrace');
  return new Promise((resolve, reject) => {
    const tmpPath = join(tmpdir(), `potrace-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
      writeFileSync(tmpPath, pngBuffer);
      const p = new potraceMod.Potrace(options);
      // Bypass broken loadImage (instanceof Jimp fails in Next.js bundler)
      // by directly using Jimp.read and then setting state on the Potrace instance
      const Jimp = require('jimp'); // eslint-disable-line @typescript-eslint/no-require-imports
      Jimp.read(tmpPath, function(err: Error | null, img: unknown) {
        try { unlinkSync(tmpPath); } catch {}
        if (err) { reject(err); return; }
        p._imageLoadingIdentifier = null;
        p._imageLoaded = true;
        p._processLoadedImage(img);
        resolve(p.getSVG());
      });
    } catch (e) {
      try { unlinkSync(tmpPath); } catch {}
      reject(e);
    }
  });
}

function potracePosterizeAsync(
  pngBuffer: Buffer,
  options: Record<string, unknown>
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const potraceMod = require('potrace');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Jimp = require('jimp');
  return new Promise((resolve, reject) => {
    const tmpPath = join(tmpdir(), `potrace-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
      writeFileSync(tmpPath, pngBuffer);
      const p = new potraceMod.Posterizer(options);
      // Posterizer.loadImage delegates to this._potrace.loadImage which has the instanceof issue
      // Bypass by directly loading the image into the internal Potrace instance
      Jimp.read(tmpPath, function(err: Error | null, img: unknown) {
        try { unlinkSync(tmpPath); } catch {}
        if (err) { reject(err); return; }
        // Set image directly on the internal Potrace instance
        p._potrace._imageLoadingIdentifier = null;
        p._potrace._imageLoaded = true;
        p._potrace._processLoadedImage(img);
        p._calculatedThreshold = null;
        resolve(p.getSVG());
      });
    } catch (e) {
      try { unlinkSync(tmpPath); } catch {}
      reject(e);
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File | null;
    const optionsJson = formData.get('options') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    const options: ConvertOptions = optionsJson
      ? JSON.parse(optionsJson)
      : {
          mode: 'detailed',
          removeBg: false,
          bgColorTolerance: 0.15,
          numberOfColors: 16,
          scale: 1,
          strokeWidth: 1,
          blurRadius: 0,
          pathOmit: 8,
          ltres: 1,
          qtres: 1,
          roundcoords: 1,
          turdSize: 2,
          alphaMax: 1,
          optCurve: true,
          cornerThreshold: 1,
        };

    // Read image buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Process with sharp
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 256;
    const originalHeight = metadata.height || 256;

    // Determine target size based on mode
    // potrace posterize is O(n * steps) so keep images small for it
    const maxDim = options.mode === 'poster' ? 400 : 800;
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (originalWidth > maxDim || originalHeight > maxDim) {
      const ratio = Math.min(maxDim / originalWidth, maxDim / originalHeight);
      targetWidth = Math.round(originalWidth * ratio);
      targetHeight = Math.round(originalHeight * ratio);
    }

    // Preprocess: resize, denoise, enhance contrast for better tracing
    let preprocessPipeline = sharp(buffer)
      .resize(targetWidth, targetHeight, { kernel: 'lanczos3' });

    // Apply blur if specified for noise reduction
    if (options.blurRadius > 0) {
      preprocessPipeline = preprocessPipeline.blur(options.blurRadius * 0.3);
    }

    // For icon mode: normalize + threshold for cleaner edges
    if (options.mode === 'icon') {
      preprocessPipeline = preprocessPipeline
        .normalize()
        .sharpen({ sigma: 0.5 });
    }

    // For detailed mode: mild sharpening
    if (options.mode === 'detailed') {
      preprocessPipeline = preprocessPipeline.sharpen({ sigma: 0.3 });
    }

    const { data, info } = await preprocessPipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const channels = info.channels;

    let processedData = data;

    // Remove background if requested
    if (options.removeBg) {
      const bgColor = detectBackgroundColor(data, width, height, channels);
      processedData = removeBackground(data, width, height, channels, bgColor, options.bgColorTolerance);
    } else if (channels === 3) {
      processedData = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        processedData[i * 4] = data[i * 3];
        processedData[i * 4 + 1] = data[i * 3 + 1];
        processedData[i * 4 + 2] = data[i * 3 + 2];
        processedData[i * 4 + 3] = 255;
      }
    }

    let svgString: string;

    if (options.mode === 'icon') {
      // Use potrace for clean monochrome tracing
      // First create a grayscale+thresholded PNG for potrace
      let potracePipeline = sharp(processedData, {
        raw: { width, height, channels: 4 },
      });

      // If background was removed, flatten onto white for potrace (it needs opaque)
      if (options.removeBg) {
        potracePipeline = potracePipeline.flatten({
          background: { r: 255, g: 255, b: 255 },
        });
      }

      const pngBuffer = await potracePipeline.png().toBuffer();

      svgString = await potraceAsync(pngBuffer, {
        turdsize: options.turdSize,
        alphamax: options.alphaMax,
        optcurve: options.optCurve,
        opttolerance: 0.2,
        cornerthreshold: options.cornerThreshold,
        unit: 1,
        scale: options.scale,
      });

      svgString = postProcessSvg(svgString, width, height);

    } else if (options.mode === 'poster') {
      // Use potrace posterize for multi-color with clean paths
      let potracePipeline = sharp(processedData, {
        raw: { width, height, channels: 4 },
      });

      if (options.removeBg) {
        potracePipeline = potracePipeline.flatten({
          background: { r: 255, g: 255, b: 255 },
        });
      }

      const pngBuffer = await potracePipeline.png().toBuffer();

      svgString = await potracePosterizeAsync(pngBuffer, {
        steps: Math.min(options.numberOfColors, 5),
        turdsize: options.turdSize,
        alphamax: options.alphaMax,
        optcurve: options.optCurve,
        opttolerance: 0.2,
        cornerthreshold: options.cornerThreshold,
        scale: options.scale,
      });

      svgString = postProcessSvg(svgString, width, height);

    } else {
      // Detailed mode: use imagetracerjs with improved settings
      const imageData = {
        width: width,
        height: height,
        data: processedData,
      };

      // Better imagetracerjs options for quality
      const traceOptions: Record<string, unknown> = {
        // Tracing accuracy
        ltres: options.ltres,
        qtres: options.qtres,
        pathomit: Math.max(options.pathOmit, 20), // Filter out tiny noise paths
        rightangleenhance: false, // Don't force right angles - looks unnatural for icons
        // Color quantization
        colorsampling: 2, // Deterministic center sampling
        numberofcolors: options.numberOfColors,
        mincolorratio: 0, // Don't skip rare colors
        colorquantcycles: 5, // More cycles = better color matching
        // Layering
        layering: 0, // Sequential layering
        // Rendering
        strokewidth: options.strokeWidth,
        linefilter: false,
        scale: options.scale,
        roundcoords: Math.max(options.roundcoords, 1), // At least 1 decimal
        viewbox: true,
        desc: false,
        lcpr: 0,
        qcpr: 0,
        blurradius: options.blurRadius,
        blurdelta: 20,
        // Path simplification
        pathomit: options.pathOmit,
      };

      svgString = ImageTracer.imagedataToSVG(imageData, traceOptions);
      svgString = postProcessSvg(svgString, width, height);
    }

    return NextResponse.json({
      svg: svgString,
      width: width,
      height: height,
      originalWidth,
      originalHeight,
      mode: options.mode,
    });
  } catch (error) {
    console.error('Conversion error:', error);
    return NextResponse.json(
      { error: 'Failed to convert image to SVG: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
