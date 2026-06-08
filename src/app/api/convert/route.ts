import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = y < borderWidth || y >= height - borderWidth || x < borderWidth || x >= width - borderWidth;
      if (!isBorder) continue;
      const idx = (y * width + x) * channels;
      if (channels === 4 && data[idx + 3] < 128) continue;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  if (samples.length === 0) return { r: 255, g: 255, b: 255 };

  const colorCounts = new Map<string, { r: number; g: number; b: number; count: number }>();
  const bucketSize = 24;

  for (const sample of samples) {
    const key = `${Math.floor(sample.r / bucketSize) * bucketSize},${Math.floor(sample.g / bucketSize) * bucketSize},${Math.floor(sample.b / bucketSize) * bucketSize}`;
    const existing = colorCounts.get(key);
    if (existing) { existing.r += sample.r; existing.g += sample.g; existing.b += sample.b; existing.count += 1; }
    else { colorCounts.set(key, { r: sample.r, g: sample.g, b: sample.b, count: 1 }); }
  }

  let maxCount = 0;
  let dominantColor = { r: 255, g: 255, b: 255 };
  for (const entry of colorCounts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      dominantColor = { r: Math.round(entry.r / entry.count), g: Math.round(entry.g / entry.count), b: Math.round(entry.b / entry.count) };
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
  const threshold = tolerance * 441.67;
  const visited = new Uint8Array(width * height);
  const queue: [number, number][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = y === 0 || y === height - 1 || x === 0 || x === width - 1;
      if (!isBorder) continue;
      const idx = (y * width + x) * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const a = channels === 4 ? data[idx + 3] : 255;
      if (a < 128) continue;
      const dist = Math.sqrt((r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2);
      if (dist < threshold) {
        const vi = y * width + x;
        if (!visited[vi]) { visited[vi] = 1; queue.push([x, y]); }
      }
    }
  }

  const dx = [0, 0, 1, -1], dy = [1, -1, 0, 0];
  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const oi = (cy * width + cx) * 4;
    result[oi] = 0; result[oi + 1] = 0; result[oi + 2] = 0; result[oi + 3] = 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d], ny = cy + dy[d];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;
      const pi = ni * channels;
      const r = data[pi], g = data[pi + 1], b = data[pi + 2];
      const a = channels === 4 ? data[pi + 3] : 255;
      if (a < 128) { queue.push([nx, ny]); continue; }
      const dist = Math.sqrt((r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2);
      if (dist < threshold * 1.2) queue.push([nx, ny]);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const vi = y * width + x;
      if (visited[vi]) continue;
      const oi = vi * 4;
      const pi = vi * channels;
      result[oi] = data[pi]; result[oi + 1] = data[pi + 1]; result[oi + 2] = data[pi + 2];
      result[oi + 3] = channels === 4 ? data[pi + 3] : 255;
    }
  }
  return result;
}

function postProcessSvg(svgString: string, width: number, height: number): string {
  let svg = svgString.replace(/\s*desc="[^"]*"/, '');
  svg = svg.replace(/<svg\s/, `<svg width="${width}" height="${height}" `);
  svg = svg.replace(/\s+opacity="1"/g, '');
  return svg;
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
      : { mode: 'poster', removeBg: false, bgColorTolerance: 0.15, numberOfColors: 8, scale: 1, strokeWidth: 0, blurRadius: 0, pathOmit: 15, ltres: 0.5, qtres: 0.5, roundcoords: 1, turdSize: 3, alphaMax: 1, optCurve: true, cornerThreshold: 1 };

    const buffer = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 256;
    const originalHeight = metadata.height || 256;

    const maxDim = options.mode === 'icon' ? 800 : 600;
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (originalWidth > maxDim || originalHeight > maxDim) {
      const ratio = Math.min(maxDim / originalWidth, maxDim / originalHeight);
      targetWidth = Math.round(originalWidth * ratio);
      targetHeight = Math.round(originalHeight * ratio);
    }

    let preprocessPipeline = sharp(buffer)
      .resize(targetWidth, targetHeight, { kernel: 'lanczos3' });

    if (options.blurRadius > 0) {
      preprocessPipeline = preprocessPipeline.blur(options.blurRadius * 0.3);
    }

    if (options.mode === 'icon') {
      preprocessPipeline = preprocessPipeline.normalize().sharpen({ sigma: 0.5 });
    } else if (options.mode === 'poster') {
      preprocessPipeline = preprocessPipeline.normalize().sharpen({ sigma: 0.4 });
    } else {
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
      // For icon mode: convert to grayscale threshold, then use imagetracerjs
      // with 2-color mode for clean monochrome output
      let iconPipeline = sharp(processedData, { raw: { width, height, channels: 4 } });
      if (options.removeBg) {
        iconPipeline = iconPipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      }
      // Convert to grayscale for better monochrome tracing
      iconPipeline = iconPipeline.grayscale().normalize();

      const { data: grayData, info: grayInfo } = await iconPipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const iconImageData = { width: grayInfo.width, height: grayInfo.height, data: grayData };

      svgString = ImageTracer.imagedataToSVG(iconImageData, {
        ltres: options.ltres,
        qtres: options.qtres,
        pathomit: options.pathOmit,
        rightangleenhance: false,
        colorsampling: 0,
        numberofcolors: 2,
        mincolorratio: 0,
        colorquantcycles: 1,
        layering: 0,
        strokewidth: 0,
        linefilter: false,
        scale: options.scale,
        roundcoords: Math.max(options.roundcoords, 1),
        viewbox: true,
        desc: false,
        lcpr: 0,
        qcpr: 0,
        blurradius: 0,
        blurdelta: 20,
      });

      svgString = postProcessSvg(svgString, width, height);

    } else {
      // Both poster and detailed modes use imagetracerjs
      const imageData = { width, height, data: processedData };

      const traceOptions: Record<string, unknown> = {
        ltres: options.ltres,
        qtres: options.qtres,
        pathomit: options.pathOmit,
        rightangleenhance: false,
        colorsampling: 2,
        numberofcolors: options.numberOfColors,
        mincolorratio: 0,
        colorquantcycles: 5,
        layering: 0,
        strokewidth: options.mode === 'poster' ? 0 : options.strokeWidth,
        linefilter: false,
        scale: options.scale,
        roundcoords: Math.max(options.roundcoords, 1),
        viewbox: true,
        desc: false,
        lcpr: 0,
        qcpr: 0,
        blurradius: options.blurRadius,
        blurdelta: 20,
      };

      svgString = ImageTracer.imagedataToSVG(imageData, traceOptions);
      svgString = postProcessSvg(svgString, width, height);
    }

    return NextResponse.json({
      svg: svgString,
      width,
      height,
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
