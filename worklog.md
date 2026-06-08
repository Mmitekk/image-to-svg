---
Task ID: 1
Agent: main
Task: Fix SVG Icon Generator - 502 Bad Gateway, button inactive, and improve quality

Work Log:
- Diagnosed 502 Bad Gateway error: potrace.Posterizer was taking 43+ seconds for poster mode, causing proxy timeouts
- Found that the Next.js server was crashing on second request due to potrace/jimp native module issues
- Removed potrace and jimp dependencies entirely - replaced with imagetracerjs for all modes
- Icon mode now uses imagetracerjs with grayscale + 2-color quantization for clean monochrome output
- Poster and detailed modes use imagetracerjs with optimized presets
- Fixed convert button being inactive: stored uploaded file in useRef instead of relying on fileInputRef.current?.files
- Added error message display in the UI when conversion fails
- Added fetch timeout (2 minutes) for large image conversions
- Updated Caddyfile with 180s read/write timeouts
- Added imagetracerjs and sharp to serverExternalPackages in next.config.ts
- Improved default quality presets: poster 8 colors (was 6), detailed 32 colors (was 24), lower ltres/qtres for more detail
- Production build confirmed working with 5+ sequential conversion requests
- Response times: poster ~0.2s, icon ~0.3s, detailed ~0.4s (vs. 43s previously for poster mode)

Stage Summary:
- 502 error fixed by removing slow potrace.Posterizer
- Server stability fixed by removing potrace/jimp native modules that caused segfaults
- Button state fixed by storing file reference properly
- SVG quality improved with better default presets
- All 3 modes (icon, poster, detailed) working in production
