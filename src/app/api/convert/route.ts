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

function postProcessSvg(svgString: string, width: number, height: number, smoothPaths: boolean = true): string {
  let svg = svgString.replace(/\s*desc="[^"]*"/, '');
  svg = svg.replace(/<svg\s/, `<svg width="${width}" height="${height}" `);
  svg = svg.replace(/\s+opacity="1"/g, '');

  if (smoothPaths) {
    // Smooth jagged paths by reducing excessive small line segments
    // Replace sequences of very short L commands with smoother curves
    svg = smoothSvgPaths(svg);
  }

  return svg;
}

/**
 * Post-process SVG paths to make them smoother.
 * - Merges tiny path segments
 * - Rounds coordinates
 * - Removes redundant close-path commands
 */
function smoothSvgPaths(svg: string): string {
  // Remove extremely small path segments that create jagged edges
  // by filtering paths with very small bounding boxes
  return svg.replace(/<path[^>]*>/g, (match) => {
    // Remove paths with only a few points and very short paths (noise)
    const dMatch = match.match(/d="([^"]*)"/);
    if (!dMatch) return match;

    let d = dMatch[1];

    // Count significant moves - if too few coordinate pairs, it's likely noise
    const commands = d.match(/[MLQCSZ]/g);
    if (commands && commands.length <= 2) return ''; // Remove tiny paths

    return match;
  });
}

/**
 * Apply morphological smoothing to RGBA buffer (simple 3x3 box blur on alpha channel edges)
 * This helps produce smoother SVG paths by removing single-pixel noise
 */
function smoothEdges(data: Buffer, width: number, height: number): Buffer {
  const result = Buffer.from(data);
  const kernel = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1],
  ];
  const kernelSum = 16;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      // Only smooth semi-transparent (edge) pixels
      const alpha = data[idx + 3];
      if (alpha === 0 || alpha === 255) continue;

      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const kidx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += data[kidx] * kernel[ky + 1][kx + 1];
          }
        }
        result[idx + c] = Math.round(sum / kernelSum);
      }
    }
  }
  return result;
}

export const maxDuration = 60; // 60 seconds for Vercel serverless functions

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

    // Limit max dimensions to prevent crashes with many colors
    // Detailed mode with 32+ colors needs smaller images to avoid timeouts
    const maxDim = options.mode === 'icon' ? 800 : (options.mode === 'detailed' ? 512 : 600);
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (originalWidth > maxDim || originalHeight > maxDim) {
      const ratio = Math.min(maxDim / originalWidth, maxDim / originalHeight);
      targetWidth = Math.round(originalWidth * ratio);
      targetHeight = Math.round(originalHeight * ratio);
    }

    // Preprocessing pipeline
    let preprocessPipeline = sharp(buffer)
      .resize(targetWidth, targetHeight, { kernel: 'lanczos3' });

    if (options.mode === 'icon') {
      // ====== ICON MODE: Clean monochrome tracing ======
      // Step 1: If removing background, do it first
      let iconBuffer = buffer;
      let w = targetWidth;
      let h = targetHeight;

      // Resize first
      const resizedBuffer = await sharp(iconBuffer)
        .resize(w, h, { kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let processedData = resizedBuffer.data;
      const rw = resizedBuffer.info.width;
      const rh = resizedBuffer.info.height;
      const rch = resizedBuffer.info.channels;

      if (options.removeBg) {
        const bgColor = detectBackgroundColor(processedData, rw, rh, rch);
        processedData = removeBackground(processedData, rw, rh, rch, bgColor, options.bgColorTolerance);
        // Smooth alpha edges for cleaner tracing
        processedData = smoothEdges(processedData, rw, rh);
      }

      // Step 2: Convert to grayscale for icon tracing
      let iconPipeline = sharp(processedData, { raw: { width: rw, height: rh, channels: 4 } });

      if (options.removeBg) {
        // For transparent bg: flatten to white first
        iconPipeline = iconPipeline
          .flatten({ background: { r: 255, g: 255, b: 255 } });
      }

      // Get grayscale image data with slight blur for smoother edges
      const { data: grayData, info: grayInfo } = await iconPipeline
        .grayscale()
        .normalize()
        .blur(0.5)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Step 3: Apply binary threshold manually on the grayscale data
      // This gives us a clean black & white image for tracing
      const gw = grayInfo.width;
      const gh = grayInfo.height;
      const gch = grayInfo.channels;

      // Manual binary threshold: pixel < 128 → black, pixel >= 128 → white
      const thresholdedData = Buffer.alloc(gw * gh * 4);
      for (let i = 0; i < gw * gh; i++) {
        const gray = grayData[i * gch]; // R channel (grayscale = all channels same)
        const alpha = gch >= 4 ? grayData[i * gch + 3] : 255;
        const isBlack = gray < 128 && alpha > 128;
        thresholdedData[i * 4] = isBlack ? 0 : 255;
        thresholdedData[i * 4 + 1] = isBlack ? 0 : 255;
        thresholdedData[i * 4 + 2] = isBlack ? 0 : 255;
        thresholdedData[i * 4 + 3] = 255;
      }

      const iconImageData = {
        width: gw,
        height: gh,
        data: thresholdedData
      };

      // Trace with imagetracerjs using 2 colors and settings optimized for smooth icons
      let svgString = ImageTracer.imagedataToSVG(iconImageData, {
        ltres: 1.0,           // Higher = fewer line segments = smoother
        qtres: 1.0,           // Higher = fewer curve segments = smoother
        pathomit: options.pathOmit || 8,  // Remove tiny noise paths
        rightangleenhance: false,         // No right-angle emphasis = smoother curves
        colorsampling: 0,                 // No random sampling for 2-color
        numberofcolors: 2,                // Black and white only
        mincolorratio: 0,
        colorquantcycles: 1,
        layering: 0,
        strokewidth: 0,
        linefilter: false,
        scale: options.scale,
        roundcoords: 2,                   // Round coordinates to 2 decimal places
        viewbox: true,
        desc: false,
        lcpr: 0,
        qcpr: 0,
        blurradius: 0,                    // Already blurred in preprocessing
        blurdelta: 20,
      });

      svgString = postProcessSvg(svgString, gw, gh, true);

      return NextResponse.json({
        svg: svgString,
        width: gw,
        height: gh,
        originalWidth,
        originalHeight,
        mode: options.mode,
      });

    } else {
      // ====== POSTER & DETAILED MODES: Color tracing ======

      // Apply mode-specific preprocessing
      if (options.mode === 'poster') {
        // Poster: normalize + light sharpening for clean edges
        preprocessPipeline = preprocessPipeline
          .normalize()
          .sharpen({ sigma: 0.3 });
      } else {
        // Detailed: lighter preprocessing to preserve detail
        preprocessPipeline = preprocessPipeline
          .normalize()
          .sharpen({ sigma: 0.2 });
      }

      // Apply blur for smoother output if requested or by default for poster
      const effectiveBlur = options.blurRadius > 0 ? options.blurRadius : (options.mode === 'poster' ? 1 : 0);
      if (effectiveBlur > 0) {
        preprocessPipeline = preprocessPipeline.blur(effectiveBlur * 0.3);
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
        // Smooth alpha edges for cleaner tracing
        processedData = smoothEdges(processedData, width, height);
      } else if (channels === 3) {
        processedData = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          processedData[i * 4] = data[i * 3];
          processedData[i * 4 + 1] = data[i * 3 + 1];
          processedData[i * 4 + 2] = data[i * 3 + 2];
          processedData[i * 4 + 3] = 255;
        }
      }

      const imageData = { width, height, data: processedData };

      // Optimized trace options for smoother output
      const numColors = options.numberOfColors;

      // For smoother curves, we use slightly higher ltres/qtres which
      // simplifies paths while keeping the overall shape accurate
      const traceOptions: Record<string, unknown> = {
        ltres: options.ltres || 1.0,     // Higher = smoother lines
        qtres: options.qtres || 1.0,     // Higher = smoother curves
        pathomit: options.pathOmit || 8, // Remove tiny paths (noise)
        rightangleenhance: false,        // No right-angle emphasis = smoother
        colorsampling: 2,                // Deterministic color sampling
        numberofcolors: numColors,
        mincolorratio: 0,
        colorquantcycles: options.mode === 'detailed' ? 6 : 8,  // Balanced cycles to avoid timeout
        layering: 0,                     // Sequential layering
        strokewidth: options.mode === 'detailed' ? options.strokeWidth : 0,
        linefilter: false,
        scale: options.scale,
        roundcoords: Math.max(options.roundcoords, 1),
        viewbox: true,
        desc: false,
        lcpr: 0,
        qcpr: 0,
        blurradius: 0,                   // Already handled in preprocessing
        blurdelta: 20,
      };

      let svgString = ImageTracer.imagedataToSVG(imageData, traceOptions);
      svgString = postProcessSvg(svgString, width, height, true);

      return NextResponse.json({
        svg: svgString,
        width,
        height,
        originalWidth,
        originalHeight,
        mode: options.mode,
      });
    }
  } catch (error) {
    console.error('Conversion error:', error);
    return NextResponse.json(
      { error: 'Failed to convert image to SVG: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
