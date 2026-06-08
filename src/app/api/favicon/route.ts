import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

interface FaviconRequest {
  svg: string;
  formats: string[];
}

const FAVICON_SIZES: Record<string, { width: number; height: number; label: string; filename: string; mimeType: string }> = {
  'svg-favicon': { width: 0, height: 0, label: 'SVG Favicon', filename: 'favicon.svg', mimeType: 'image/svg+xml' },
  'ico-favicon': { width: 32, height: 32, label: 'ICO Favicon', filename: 'favicon.ico', mimeType: 'image/x-icon' },
  'android-192': { width: 192, height: 192, label: 'Android PNG 192×192', filename: 'android-chrome-192x192.png', mimeType: 'image/png' },
  'apple-touch': { width: 180, height: 180, label: 'Apple Touch PNG 180×180', filename: 'apple-touch-icon.png', mimeType: 'image/png' },
  'favicon-96': { width: 96, height: 96, label: 'Favicon PNG 96×96', filename: 'favicon-96x96.png', mimeType: 'image/png' },
  'favicon-32': { width: 32, height: 32, label: 'Favicon PNG 32×32', filename: 'favicon-32x32.png', mimeType: 'image/png' },
};

/**
 * Create an ICO file from a PNG buffer.
 * ICO format: header + directory entries + image data
 */
function createIcoFromPng(pngBuffer: Buffer, width: number, height: number): Buffer {
  const imageCount = 1;
  
  // ICO Header (6 bytes): reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // Reserved
  header.writeUInt16LE(1, 2);      // Type: 1 = ICO
  header.writeUInt16LE(imageCount, 4); // Number of images
  
  // Directory entry (16 bytes per image)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width === 256 ? 0 : width, 0);   // Width (0 = 256)
  entry.writeUInt8(height === 256 ? 0 : height, 1);  // Height (0 = 256)
  entry.writeUInt8(0, 2);           // Color palette count
  entry.writeUInt8(0, 3);           // Reserved
  entry.writeUInt16LE(1, 4);        // Color planes
  entry.writeUInt16LE(32, 6);       // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);  // Image data size
  entry.writeUInt32LE(6 + 16 * imageCount, 12); // Offset to image data
  
  return Buffer.concat([header, entry, pngBuffer]);
}

export async function POST(request: NextRequest) {
  try {
    const body: FaviconRequest = await request.json();
    const { svg, formats } = body;

    if (!svg || !formats || formats.length === 0) {
      return NextResponse.json({ error: 'SVG content and formats are required' }, { status: 400 });
    }

    // Validate SVG
    if (!svg.includes('<svg')) {
      return NextResponse.json({ error: 'Invalid SVG content' }, { status: 400 });
    }

    const results: Record<string, { data: string; mimeType: string; filename: string; label: string }> = {};
    const svgBuffer = Buffer.from(svg);

    for (const format of formats) {
      const spec = FAVICON_SIZES[format];
      if (!spec) continue;

      if (format === 'svg-favicon') {
        // SVG favicon - just return the SVG as base64
        results[format] = {
          data: svgBuffer.toString('base64'),
          mimeType: spec.mimeType,
          filename: spec.filename,
          label: spec.label,
        };
      } else if (format === 'ico-favicon') {
        // ICO favicon - generate PNG then wrap in ICO format
        // Use multiple sizes for better compatibility: 16x16, 32x32, 48x48
        const sizes = [16, 32, 48];
        const pngBuffers: Buffer[] = [];
        
        for (const size of sizes) {
          const png = await sharp(svgBuffer)
            .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          pngBuffers.push(png);
        }

        // Create multi-size ICO
        const imageCount = pngBuffers.length;
        const headerSize = 6;
        const dirEntrySize = 16;
        const dirSize = dirEntrySize * imageCount;
        
        const header = Buffer.alloc(headerSize);
        header.writeUInt16LE(0, 0);          // Reserved
        header.writeUInt16LE(1, 2);          // Type: 1 = ICO
        header.writeUInt16LE(imageCount, 4); // Number of images
        
        let dataOffset = headerSize + dirSize;
        const dirEntries: Buffer[] = [];
        
        for (let i = 0; i < imageCount; i++) {
          const size = sizes[i];
          const pngBuf = pngBuffers[i];
          const entry = Buffer.alloc(dirEntrySize);
          entry.writeUInt8(size, 0);           // Width
          entry.writeUInt8(size, 1);           // Height
          entry.writeUInt8(0, 2);              // Color palette count
          entry.writeUInt8(0, 3);              // Reserved
          entry.writeUInt16LE(1, 4);           // Color planes
          entry.writeUInt16LE(32, 6);          // Bits per pixel
          entry.writeUInt32LE(pngBuf.length, 8);  // Image data size
          entry.writeUInt32LE(dataOffset, 12);     // Offset to image data
          dirEntries.push(entry);
          dataOffset += pngBuf.length;
        }
        
        const icoBuffer = Buffer.concat([header, ...dirEntries, ...pngBuffers]);
        
        results[format] = {
          data: icoBuffer.toString('base64'),
          mimeType: spec.mimeType,
          filename: spec.filename,
          label: spec.label,
        };
      } else {
        // PNG formats
        const pngBuffer = await sharp(svgBuffer)
          .resize(spec.width, spec.height, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();

        results[format] = {
          data: pngBuffer.toString('base64'),
          mimeType: spec.mimeType,
          filename: spec.filename,
          label: spec.label,
        };
      }
    }

    return NextResponse.json({ favicons: results });
  } catch (error) {
    console.error('Favicon generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate favicons: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
