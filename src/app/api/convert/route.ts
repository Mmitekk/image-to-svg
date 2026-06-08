import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ImageTracer = require('imagetracerjs/imagetracer_v1.2.6.js');

interface ConvertOptions {
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
}

function detectBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): { r: number; g: number; b: number } {
  const samples: { r: number; g: number; b: number }[] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 20));

  // Sample corners and edges
  for (let y = 0; y < Math.min(height, 10); y += step) {
    for (let x = 0; x < Math.min(width, 10); x += step) {
      const idx = (y * width + x) * channels;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
    for (let x = Math.max(0, width - 10); x < width; x += step) {
      const idx = (y * width + x) * channels;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  for (let y = Math.max(0, height - 10); y < height; y += step) {
    for (let x = 0; x < Math.min(width, 10); x += step) {
      const idx = (y * width + x) * channels;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
    for (let x = Math.max(0, width - 10); x < width; x += step) {
      const idx = (y * width + x) * channels;
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  // Find most common color cluster
  const colorCounts = new Map<string, { color: { r: number; g: number; b: number }; count: number }>();
  const bucketSize = 16;

  for (const sample of samples) {
    const br = Math.floor(sample.r / bucketSize) * bucketSize;
    const bg = Math.floor(sample.g / bucketSize) * bucketSize;
    const bb = Math.floor(sample.b / bucketSize) * bucketSize;
    const key = `${br},${bg},${bb}`;

    const existing = colorCounts.get(key);
    if (existing) {
      existing.color.r += sample.r;
      existing.color.g += sample.g;
      existing.color.b += sample.b;
      existing.count += 1;
    } else {
      colorCounts.set(key, { color: { ...sample }, count: 1 });
    }
  }

  let maxCount = 0;
  let dominantColor = { r: 255, g: 255, b: 255 };

  for (const entry of colorCounts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      dominantColor = {
        r: Math.round(entry.color.r / entry.count),
        g: Math.round(entry.color.g / entry.count),
        b: Math.round(entry.color.b / entry.count),
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
  const result = Buffer.alloc(width * height * 4); // Always output RGBA
  const threshold = tolerance * 255;
  const softEdge = threshold * 0.3; // 30% of threshold for soft edge

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const outIdx = (y * width + x) * 4;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = channels === 4 ? data[idx + 3] : 255;

      // Calculate distance from background color
      const dist = Math.sqrt(
        (r - bgColor.r) ** 2 + (g - bgColor.g) ** 2 + (b - bgColor.b) ** 2
      );

      if (dist < threshold - softEdge) {
        // Fully transparent - background pixel
        result[outIdx] = 0;
        result[outIdx + 1] = 0;
        result[outIdx + 2] = 0;
        result[outIdx + 3] = 0;
      } else if (dist < threshold) {
        // Soft edge - partial transparency
        const t = (dist - (threshold - softEdge)) / softEdge;
        const alpha = Math.floor(t * 255);
        result[outIdx] = r;
        result[outIdx + 1] = g;
        result[outIdx + 2] = b;
        result[outIdx + 3] = Math.floor(alpha * (a / 255));
      } else {
        // Keep as-is - foreground pixel
        result[outIdx] = r;
        result[outIdx + 1] = g;
        result[outIdx + 2] = b;
        result[outIdx + 3] = a;
      }
    }
  }

  return result;
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
        };

    // Read image buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Process with sharp
    let pipeline = sharp(buffer);
    const metadata = await pipeline.metadata();
    const originalWidth = metadata.width || 256;
    const originalHeight = metadata.height || 256;

    // Limit max dimension to 512 for performance
    const maxDim = 512;
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (originalWidth > maxDim || originalHeight > maxDim) {
      const ratio = Math.min(maxDim / originalWidth, maxDim / originalHeight);
      targetWidth = Math.round(originalWidth * ratio);
      targetHeight = Math.round(originalHeight * ratio);
    }

    pipeline = sharp(buffer).resize(targetWidth, targetHeight);

    // Ensure RGBA output
    const { data, info } = await pipeline
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
      // Convert RGB to RGBA for imagetracerjs compatibility
      processedData = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        processedData[i * 4] = data[i * 3];
        processedData[i * 4 + 1] = data[i * 3 + 1];
        processedData[i * 4 + 2] = data[i * 3 + 2];
        processedData[i * 4 + 3] = 255;
      }
    }

    // Create ImageData object for imagetracerjs
    const imageData = {
      width: width,
      height: height,
      data: processedData,
    };

    // Build imagetracerjs options
    const traceOptions: Record<string, unknown> = {
      ltres: options.ltres,
      qtres: options.qtres,
      pathomit: options.pathOmit,
      rightangleenhance: true,
      colorsampling: 2,
      numberofcolors: options.numberOfColors,
      mincolorratio: 0,
      colorquantcycles: 3,
      layering: 0,
      strokewidth: options.strokeWidth,
      linefilter: false,
      scale: options.scale,
      roundcoords: options.roundcoords,
      viewbox: true,
      desc: false,
      lcpr: 0,
      qcpr: 0,
      blurradius: options.blurRadius,
      blurdelta: 20,
    };

    // Trace to SVG
    let svgString = ImageTracer.imagedataToSVG(imageData, traceOptions);

    // Fix: imagetracerjs outputs SVG with viewBox but no width/height attributes,
    // which causes the SVG to render at 0x0 when injected via dangerouslySetInnerHTML.
    // Add explicit width and height attributes to the SVG element.
    svgString = svgString.replace(
      /<svg\s/,
      `<svg width="${width}" height="${height}" `
    );

    return NextResponse.json({
      svg: svgString,
      width: width,
      height: height,
      originalWidth,
      originalHeight,
    });
  } catch (error) {
    console.error('Conversion error:', error);
    return NextResponse.json(
      { error: 'Failed to convert image to SVG' },
      { status: 500 }
    );
  }
}
