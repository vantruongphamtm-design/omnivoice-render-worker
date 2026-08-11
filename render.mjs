// Render 1 SEGMENT của composition "StoryVideo" từ bundle dựng sẵn (/app/remotion/bundle).
// Dùng bởi handler.py: node render.mjs <props.json> <out.mp4>
// GL renderer & chrome mode đọc từ ENV (REMOTION_GL / REMOTION_CHROME_MODE) → handler
// có thể thử GPU rồi fallback CPU mà không cần đổi code.
import {selectComposition, renderMedia, ensureBrowser} from '@remotion/renderer';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const [, , propsPath, outPath] = process.argv;
if (!propsPath || !outPath) {
  console.error('usage: node render.mjs <props.json> <out.mp4>');
  process.exit(2);
}

const inputProps = JSON.parse(fs.readFileSync(propsPath, 'utf-8'));
const serveUrl = path.resolve(process.env.REMOTION_BUNDLE || '/app/remotion/bundle');
const gl = process.env.REMOTION_GL || 'angle-egl';
const chromeMode = process.env.REMOTION_CHROME_MODE || 'chrome-for-testing';
const concurrency = Math.max(1, os.cpus().length); // đa luồng tối đa số nhân CPU

const log = (...a) => console.log('[render]', ...a);
log(`gl=${gl} chromeMode=${chromeMode} concurrency=${concurrency} scenes=${(inputProps.scenes || []).length}`);

async function main() {
  await ensureBrowser({chromeMode});
  const composition = await selectComposition({serveUrl, id: 'StoryVideo', inputProps, chromeMode});
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outPath,
    inputProps,
    concurrency,
    chromeMode,
    chromiumOptions: {gl},
    timeoutInMilliseconds: 120000, // frame nặng → nới timeout delayRender
  });
  log('OK', outPath);
}

main().catch((e) => {
  console.error('[render] FAIL', (e && e.stack) || e);
  process.exit(1);
});
