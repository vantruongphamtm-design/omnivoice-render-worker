# OmniStudio — RunPod Serverless GPU worker: render 1 segment Remotion "StoryVideo".
# Base = node:20-bookworm (chính là base GPU CHÍNH THỨC của Remotion). KHÔNG dùng CUDA/torch:
# render dùng GPU qua ANGLE/EGL do nvidia-container-runtime bơm vào → KHÔNG có ràng buộc
# cuda>=X.Y nên chạy được trên MỌI host GPU của RunPod (tránh lỗi "unsatisfied condition: cuda>=12.8").
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
# Cho headless Chrome dùng GPU qua nvidia runtime (RunPod tự gắn GPU vào worker)
ENV NVIDIA_DRIVER_CAPABILITIES=all
ENV NVIDIA_VISIBLE_DEVICES=all
# GL renderer + chrome mode mặc định — đổi qua ENV endpoint mà KHÔNG cần build lại
ENV REMOTION_GL=vulkan
ENV REMOTION_CHROME_MODE=chrome-for-testing

# Python3 (chạy handler runpod) + ffmpeg + phụ thuộc Chrome (Debian bookworm: tên gói GỐC,
# không t64) + font tiếng Việt + loader GL/Vulkan cho ANGLE.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
      ffmpeg fontconfig \
      fonts-noto-core fonts-noto-cjk fonts-liberation fonts-dejavu-core \
      libnss3 libdbus-1-3 libxrandr2 libxfixes3 libxcomposite1 libxdamage1 \
      libxkbcommon0 libpango-1.0-0 libcairo2 libgbm1 libglib2.0-0 \
      libgl1 libegl1 libgles2 libglx0 libvulkan1 libxi6 libxtst6 libxrender1 \
      libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 && \
    fc-cache -f && \
    rm -rf /var/lib/apt/lists/*

# RunPod SDK cho handler Python (Debian PEP 668 → cần --break-system-packages)
RUN pip3 install --no-cache-dir --break-system-packages "runpod>=1.6.0"

WORKDIR /app/remotion

# Node deps của project + gói render API (tách lớp để cache theo lock). Node đã có sẵn trong base.
COPY remotion/package.json remotion/package-lock.json ./
RUN npm ci && npm i @remotion/renderer@4.0.504 @remotion/bundler@4.0.504

# Toàn bộ source Remotion (node_modules bị .dockerignore loại)
COPY remotion/ ./

# Chrome for Testing (để GPU trên Linux) + headless-shell (fallback CPU). Lỗi tải không làm hỏng build.
RUN node -e "require('@remotion/renderer').ensureBrowser({chromeMode:'chrome-for-testing'}).then(()=>console.log('CfT ok')).catch(e=>{console.error('CfT fail:',e&&e.message);process.exit(0)})" && \
    node -e "require('@remotion/renderer').ensureBrowser().then(()=>console.log('shell ok')).catch(e=>{console.error('shell fail:',e&&e.message);process.exit(0)})"

# Scripts + BUNDLE sẵn site lúc build → cold render bỏ qua bundling
COPY render.mjs bundle.mjs ./
RUN node bundle.mjs

# Handler RunPod + engine ffmpeg (mode:"ffmpeg" — render cảnh nhanh 10-40x, NVENC nếu có)
COPY src/handler.py /app/handler.py
COPY src/ffmpeg_engine.py /app/ffmpeg_engine.py
WORKDIR /app
CMD ["python3", "-u", "/app/handler.py"]
