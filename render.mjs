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
const gl = process.env.REMOTION_GL || 'vulkan'; // vulkan ổn định + nhanh trên MỌI worker RunPod (angle-egl chỉ ~50% máy)
const chromeMode = process.env.REMOTION_CHROME_MODE || 'chrome-for-testing';
// Cap concurrency: RunPod báo full vCPU của HOST (32+) nhưng container bị giới hạn →
// nếu để = cores, Remotion mở pool = min(cores, frames) tab Chrome → overcommit /dev/shm
// → Chrome crash ("got no response"). Đã song song across 5 worker nên mỗi worker chỉ
// cần vài luồng. Chỉnh qua ENV REMOTION_CONCURRENCY, KHÔNG cần build lại image.
const concurrency = Math.max(
  1,
  parseInt(process.env.REMOTION_CONCURRENCY || '', 10) || Math.min(os.cpus().length, 4),
);

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
    x264Preset: 'veryfast',        // cùng crf → chất lượng giữ nguyên, encode nhanh hơn hẳn
    offthreadVideoCacheSizeInBytes: 1_500_000_000, // cache khung video nền (Pexels) → đỡ re-seek
  });
  log('OK', outPath);
}

main().catch((e) => {
  console.error('[render] FAIL', (e && e.stack) || e);
  process.exit(1);
});
