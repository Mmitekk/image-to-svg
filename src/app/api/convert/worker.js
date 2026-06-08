// Worker process for SVG conversion
// Runs in isolation to avoid memory issues from native modules crashing the main server

const sharp = require('sharp');
const ImageTracer = require('imagetracerjs/imagetracer_v1.2.6.js');
const potrace = require('potrace');
const Jimp = require('jimp');
const { writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const INPUT_PATH = process.env.INPUT_PATH;
const OPTIONS = JSON.parse(process.env.OPTIONS || '{}');

async function run() {
  try {
    const buffer = require('fs').readFileSync(INPUT_PATH);

    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 256;
    const originalHeight = metadata.height || 256;

    const maxDim = OPTIONS.mode === 'icon' ? 800 : 600;
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (originalWidth > maxDim || originalHeight > maxDim) {
      const ratio = Math.min(maxDim / originalWidth, maxDim / originalHeight);
      targetWidth = Math.round(originalWidth * ratio);
      targetHeight = Math.round(originalHeight * ratio);
    }

    let preprocessPipeline = sharp(buffer)
      .resize(targetWidth, targetHeight, { kernel: 'lanczos3' });

    if (OPTIONS.blurRadius > 0) {
      preprocessPipeline = preprocessPipeline.blur(OPTIONS.blurRadius * 0.3);
    }

    if (OPTIONS.mode === 'icon') {
      preprocessPipeline = preprocessPipeline.normalize().sharpen({ sigma: 0.5 });
    } else if (OPTIONS.mode === 'poster') {
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

    if (OPTIONS.removeBg) {
      processedData = removeBackground(data, width, height, channels, OPTIONS.bgColorTolerance || 0.15);
    } else if (channels === 3) {
      processedData = Buffer.alloc(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        processedData[i * 4] = data[i * 3];
        processedData[i * 4 + 1] = data[i * 3 + 1];
        processedData[i * 4 + 2] = data[i * 3 + 2];
        processedData[i * 4 + 3] = 255;
      }
    }

    let svgString;

    if (OPTIONS.mode === 'icon') {
      let potracePipeline = sharp(processedData, { raw: { width, height, channels: 4 } });
      if (OPTIONS.removeBg) {
        potracePipeline = potracePipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      }
      const pngBuffer = await potracePipeline.png().toBuffer();
      svgString = await potraceAsync(pngBuffer, {
        turdsize: OPTIONS.turdSize || 5,
        alphamax: OPTIONS.alphaMax || 1,
        optcurve: OPTIONS.optCurve !== false,
        opttolerance: 0.2,
        cornerthreshold: OPTIONS.cornerThreshold || 1,
        unit: 1,
        scale: OPTIONS.scale || 1,
      });
      svgString = postProcessSvg(svgString, width, height);
    } else {
      const imageData = { width, height, data: processedData };

      const traceOptions = {
        ltres: OPTIONS.ltres || 0.5,
        qtres: OPTIONS.qtres || 0.5,
        pathomit: OPTIONS.mode === 'poster' ? Math.max(OPTIONS.pathOmit || 15, 15) : (OPTIONS.pathOmit || 8),
        rightangleenhance: false,
        colorsampling: 2,
        numberofcolors: OPTIONS.numberOfColors || 8,
        mincolorratio: 0,
        colorquantcycles: 5,
        layering: 0,
        strokewidth: OPTIONS.mode === 'poster' ? 0 : (OPTIONS.strokeWidth || 1),
        linefilter: false,
        scale: OPTIONS.scale || 1,
        roundcoords: Math.max(OPTIONS.roundcoords || 1, 1),
        viewbox: true,
        desc: false,
        lcpr: 0,
        qcpr: 0,
        blurradius: OPTIONS.blurRadius || 0,
        blurdelta: 20,
      };

      svgString = ImageTracer.imagedataToSVG(imageData, traceOptions);
      svgString = postProcessSvg(svgString, width, height);
    }

    const result = {
      svg: svgString,
      width, height,
      originalWidth, originalHeight,
      mode: OPTIONS.mode,
    };

    // Write result to output file for the parent process to read
    const outputPath = process.env.OUTPUT_PATH;
    if (outputPath) {
      require('fs').writeFileSync(outputPath, JSON.stringify(result));
    } else {
      process.stdout.write(JSON.stringify(result));
    }
  } catch (error) {
    const errorResult = {
      error: error instanceof Error ? error.message : String(error),
    };
    const outputPath = process.env.OUTPUT_PATH;
    if (outputPath) {
      require('fs').writeFileSync(outputPath, JSON.stringify(errorResult));
    } else {
      process.stdout.write(JSON.stringify(errorResult));
    }
  }
}

function removeBackground(data, width, height, channels, tolerance) {
  const bgColor = detectBackgroundColor(data, width, height, channels);
  const result = Buffer.alloc(width * height * 4);
  const threshold = tolerance * 441.67;
  const visited = new Uint8Array(width * height);
  const queue = [];

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
      const oi = vi * 4;
      if (visited[vi]) continue;
      const pi = vi * channels;
      result[oi] = data[pi]; result[oi + 1] = data[pi + 1]; result[oi + 2] = data[pi + 2];
      result[oi + 3] = channels === 4 ? data[pi + 3] : 255;
    }
  }
  return result;
}

function detectBackgroundColor(data, width, height, channels) {
  const samples = [];
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
  const colorCounts = new Map();
  const bucketSize = 24;
  for (const sample of samples) {
    const key = `${Math.floor(sample.r / bucketSize) * bucketSize},${Math.floor(sample.g / bucketSize) * bucketSize},${Math.floor(sample.b / bucketSize) * bucketSize}`;
    const existing = colorCounts.get(key);
    if (existing) { existing.r += sample.r; existing.g += sample.g; existing.b += sample.b; existing.count += 1; }
    else { colorCounts.set(key, { r: sample.r, g: sample.g, b: sample.b, count: 1 }); }
  }
  let maxCount = 0, dominantColor = { r: 255, g: 255, b: 255 };
  for (const entry of colorCounts.values()) {
    if (entry.count > maxCount) {
      maxCount = entry.count;
      dominantColor = { r: Math.round(entry.r / entry.count), g: Math.round(entry.g / entry.count), b: Math.round(entry.b / entry.count) };
    }
  }
  return dominantColor;
}

function postProcessSvg(svgString, width, height) {
  let svg = svgString.replace(/\s*desc="[^"]*"/, '');
  svg = svg.replace(/<svg\s/, `<svg width="${width}" height="${height}" `);
  svg = svg.replace(/\s+opacity="1"/g, '');
  return svg;
}

function potraceAsync(pngBuffer, options) {
  return new Promise((resolve, reject) => {
    const tmpPath = join(tmpdir(), `potrace-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
      writeFileSync(tmpPath, pngBuffer);
      const p = new potrace.Potrace(options);
      Jimp.read(tmpPath, function(err, img) {
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

run().catch(e => {
  const errorResult = { error: e instanceof Error ? e.message : String(e) };
  const outputPath = process.env.OUTPUT_PATH;
  if (outputPath) {
    require('fs').writeFileSync(outputPath, JSON.stringify(errorResult));
  } else {
    process.stdout.write(JSON.stringify(errorResult));
  }
});
