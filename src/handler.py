# -*- coding: utf-8 -*-
"""RunPod Serverless QUEUE handler cho OmniStudio — render 1 SEGMENT Remotion trên GPU.

Mỗi job render một đoạn (segment) của composition "StoryVideo" rồi HTTP-PUT thẳng
file mp4 lên một presigned S3 URL do APP tạo (worker KHÔNG cần AWS creds).

Input  (job["input"]):
  {
    "props":   { title, bgmUrl, scenes:[{ text, imageUrl, preset, intensity,
                 keywords, audioUrl, durationInFrames }] },   # 1 segment @30fps
    "put_url": "<presigned S3 PUT url>",                       # bắt buộc
    "gl":      "angle-egl"                                     # tuỳ chọn -> REMOTION_GL
  }

Output:
  { "ok": true, "bytes": <int> }                         # thành công
  { "error": "<str>", "log": "<tail stderr render, 1500 ký tự cuối>" }   # lỗi

Node render script (do Agent 1 cung cấp) nằm ở /app/render.mjs và được gọi:
  node /app/render.mjs /tmp/props.json /tmp/out.mp4   (cwd=/app)
"""
import os
import json
import time
import subprocess
import urllib.request
import urllib.error

import runpod

PROPS_PATH = "/tmp/props.json"
OUT_PATH = "/tmp/out.mp4"
RENDER_SCRIPT = "/app/remotion/render.mjs"
RENDER_CWD = "/app/remotion"
PUT_TIMEOUT = 900        # giây — cho phép upload file lớn
PUT_RETRIES = 3

# Fallback CPU khi GPU (angle-egl + chrome-for-testing) lỗi: swangle = software GL của
# Remotion, chạy với headless-shell → luôn render được (chậm hơn nhưng chắc chắn ra video).
GL_DEFAULT = os.environ.get("REMOTION_GL", "vulkan")   # vulkan chạy ổn định trên mọi worker RunPod
CHROME_DEFAULT = os.environ.get("REMOTION_CHROME_MODE", "chrome-for-testing")
GL_FALLBACK = "swangle"
CHROME_FALLBACK = "headless-shell"


def _safe_remove(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _run_render(props_path, out_path, gl, chrome_mode):
    """Gọi Node render script với 1 cấu hình GL/chrome. Trả CompletedProcess (text)."""
    env = os.environ.copy()
    if gl:
        env["REMOTION_GL"] = str(gl)          # angle-egl (GPU) / swangle (CPU) / vulkan
    if chrome_mode:
        env["REMOTION_CHROME_MODE"] = str(chrome_mode)  # chrome-for-testing / headless-shell
    return subprocess.run(
        ["node", RENDER_SCRIPT, props_path, out_path],
        cwd=RENDER_CWD,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _attempt(props_path, out_path, gl, chrome_mode):
    """1 lần render + kiểm tra output. Trả (ok, log). Không raise."""
    _safe_remove(out_path)
    proc = _run_render(props_path, out_path, gl, chrome_mode)
    log = (proc.stdout or "") + "\n" + (proc.stderr or "")
    ok = (proc.returncode == 0 and os.path.exists(out_path)
          and os.path.getsize(out_path) > 0)
    return ok, log


def _put_file(path, url):
    """Stream file lên presigned S3 PUT url bằng urllib (KHÔNG boto/aws-sdk).

    Đặt Content-Length rõ ràng -> tránh chunked transfer-encoding (S3 không ưa) và
    tránh nạp toàn bộ file vào RAM (http.client đọc file theo block ~8KB).
    """
    size = os.path.getsize(path)
    last_err = None
    for attempt in range(PUT_RETRIES):
        body = None
        try:
            body = open(path, "rb")  # mở mới mỗi lần thử -> con trỏ về đầu file
            req = urllib.request.Request(
                url,
                data=body,
                method="PUT",
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(size),
                },
            )
            with urllib.request.urlopen(req, timeout=PUT_TIMEOUT) as resp:
                code = getattr(resp, "status", None) or resp.getcode()
                if not (200 <= int(code) < 300):
                    raise RuntimeError(f"S3 PUT trả HTTP {code}")
                return int(code)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                pass
            last_err = RuntimeError(f"S3 PUT HTTPError {e.code}: {detail}")
            # 4xx (403 SignatureDoesNotMatch, 400 …) sẽ không tự khỏi khi retry
            if 400 <= e.code < 500:
                raise last_err
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = RuntimeError(f"S3 PUT lỗi mạng: {e}")
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:
                    pass
        time.sleep(2 * (attempt + 1))
    raise last_err if last_err else RuntimeError("S3 PUT thất bại")


def handler(job):
    inp = job.get("input", {}) or {}
    props = inp.get("props")
    put_url = inp.get("put_url")
    gl = inp.get("gl")
    render_log = ""

    if not isinstance(props, dict):
        return {"error": "thiếu 'props' (object) trong input"}
    # put_url TUỲ CHỌN: có → PUT mp4 lên S3; không → chỉ render (dùng cho test Hub).
    if put_url is not None and not isinstance(put_url, str):
        return {"error": "'put_url' phải là chuỗi presigned S3 PUT"}

    try:
        with open(PROPS_PATH, "w", encoding="utf-8") as f:
            json.dump(props, f, ensure_ascii=False)

        # Lần 1: GPU (gl từ input hoặc mặc định angle-egl + chrome-for-testing).
        gl1 = gl or GL_DEFAULT
        ok, render_log = _attempt(PROPS_PATH, OUT_PATH, gl1, CHROME_DEFAULT)

        # Lần 2 (nếu lần 1 hỏng và chưa phải CPU): fallback swangle + headless-shell.
        if not ok and gl1 != GL_FALLBACK:
            print(f"[handler] GPU render lỗi (gl={gl1}) → fallback {GL_FALLBACK}/CPU", flush=True)
            ok, log2 = _attempt(PROPS_PATH, OUT_PATH, GL_FALLBACK, CHROME_FALLBACK)
            render_log = render_log + "\n----- FALLBACK swangle/CPU -----\n" + log2

        if not ok:
            raise RuntimeError("render.mjs thất bại cả GPU lẫn CPU fallback")

        size = os.path.getsize(OUT_PATH)
        if put_url:
            _put_file(OUT_PATH, put_url)
            return {"ok": True, "bytes": size, "uploaded": True}
        # Không có put_url (test) → render xong là đạt, bỏ qua upload.
        return {"ok": True, "bytes": size, "uploaded": False}

    except Exception as e:
        return {"error": str(e), "log": (render_log or "")[-1500:]}
    finally:
        _safe_remove(PROPS_PATH)
        _safe_remove(OUT_PATH)


print("[handler] OmniStudio render worker sẵn sàng (render.mjs @ /app)", flush=True)
runpod.serverless.start({"handler": handler})
