# OmniStudio — RunPod Serverless GPU worker: render 1 segment Remotion "StoryVideo".
# Base = ảnh RunPod (CUDA 12.8, có sẵn python3+pip, đã chứng minh build/chạy trên RunPod GPU).
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

ENV DEBIAN_FRONTEND=noninteractive
# Cho headless Chrome dùng GPU qua nvidia runtime (RunPod tự gắn GPU vào worker)
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all
# GL renderer + chrome mode mặc định — đổi qua ENV của endpoint mà KHÔNG cần build lại
ENV REMOTION_GL=angle-egl
ENV REMOTION_CHROME_MODE=chrome-for-testing

# --- Node 20 ---
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# --- ffmpeg + phụ thuộc Chrome + font tiếng Việt + loader GL/Vulkan ---
# Ubuntu 24.04: vài gói đổi hậu tố t64 → thử t64 trước, fallback tên cũ (không làm hỏng build).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fontconfig \
      fonts-noto-core fonts-noto-cjk fonts-liberation fonts-dejavu-core \
      libnss3 libdbus-1-3 libxrandr2 libxfixes3 libxcomposite1 libxdamage1 \
      libxkbcommon0 libpango-1.0-0 libcairo2 libgbm1 libglib2.0-0 \
      libgl1 libegl1 libgles2 libglx0 libvulkan1 libxi6 libxtst6 libxrender1 && \
    ( apt-get install -y --no-install-recommends libasound2t64 || apt-get install -y --no-install-recommends libasound2 ) && \
    ( apt-get install -y --no-install-recommends libatk1.0-0t64 || apt-get install -y --no-install-recommends libatk1.0-0 ) && \
    ( apt-get install -y --no-install-recommends libatk-bridge2.0-0t64 || apt-get install -y --no-install-recommends libatk-bridge2.0-0 ) && \
    ( apt-get install -y --no-install-recommends libcups2t64 || apt-get install -y --no-install-recommends libcups2 ) && \
    fc-cache -f && \
    rm -rf /var/lib/apt/lists/*

# --- RunPod SDK (handler Python) ---
# cryptography do apt cài (no RECORD) → cài lại bằng pip trước để tránh lỗi uninstall.
RUN pip install --no-cache-dir --ignore-installed cryptography && \
    pip install --no-cache-dir "runpod>=1.6.0"

WORKDIR /app/remotion

# Node deps của project + gói render API (tách lớp để cache theo lock)
COPY remotion/package.json remotion/package-lock.json ./
RUN npm ci && npm i @remotion/renderer@4.0.504 @remotion/bundler@4.0.504

# Toàn bộ source Remotion (node_modules bị .dockerignore loại)
COPY remotion/ ./

# Chrome for Testing (bắt buộc để GPU trên Linux) + headless-shell (fallback CPU).
# Lỗi tải CfT không làm hỏng build (process.exit(0)) — khi đó handler tự fallback swangle/CPU.
RUN node -e "require('@remotion/renderer').ensureBrowser({chromeMode:'chrome-for-testing'}).then(()=>console.log('CfT ok')).catch(e=>{console.error('CfT fail:',e&&e.message);process.exit(0)})" && \
    node -e "require('@remotion/renderer').ensureBrowser().then(()=>console.log('shell ok')).catch(e=>{console.error('shell fail:',e&&e.message);process.exit(0)})"

# Scripts + BUNDLE sẵn site lúc build → cold render bỏ qua bundling (nhanh hơn)
COPY render.mjs bundle.mjs ./
RUN node bundle.mjs

# Handler RunPod
COPY src/handler.py /app/handler.py
WORKDIR /app
CMD ["python3", "-u", "/app/handler.py"]
