# OmniStudio — RunPod Serverless Render Worker

Render một **segment** (≤4000 khung) của composition Remotion `StoryVideo` bằng **GPU**,
rồi HTTP-PUT file `.mp4` thẳng lên một **presigned S3 URL** do app cấp (worker không giữ AWS creds).
Input: `{ props:{...1 segment...}, put_url:"<presigned PUT>", gl?:"angle-egl" }` → Output: `{ ok:true, bytes:N }`.
Node render script nằm ở `/app/render.mjs`; handler gọi `node /app/render.mjs /tmp/props.json /tmp/out.mp4`.
**Không có Docker local** — RunPod tự build image từ GitHub repo này (xem deploy ở dưới / notes của Agent).
