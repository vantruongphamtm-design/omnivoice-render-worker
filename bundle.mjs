// Bundle site Remotion sẵn LÚC BUILD → serveUrl = /app/remotion/bundle.
// Nhờ vậy mỗi lần render (cold start) không phải bundle lại → nhanh hơn nhiều.
import {bundle} from '@remotion/bundler';
import path from 'node:path';

// Mặc định trong container; override qua ENV để test cục bộ.
const entry = path.resolve(process.env.REMOTION_ENTRY || '/app/remotion/src/index.ts');
const outDir = path.resolve(process.env.REMOTION_BUNDLE || '/app/remotion/bundle');

const serveUrl = await bundle({
  entryPoint: entry,
  outDir,
  onProgress: (p) => {
    if (p % 20 === 0) console.log(`[bundle] ${p}%`);
  },
});

console.log('BUNDLE_OK', serveUrl);
