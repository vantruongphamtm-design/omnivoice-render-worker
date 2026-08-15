# -*- coding: utf-8 -*-
"""Engine render ffmpeg — tái tạo giao diện StoryVideo (Remotion) nhanh 10-40 lần.

Mỗi CẢNH render độc lập thành 1 clip (song song hóa hoàn toàn), transition "nướng" vào
đầu clip (dissolve từ khung cuối cảnh trước — dựng ảnh tĩnh độc lập, KHÔNG cần đợi cảnh
trước render xong) → ghép cuối cùng bằng concat -c copy (tức thì, không re-encode).

Tái tạo hiệu ứng (map từ remotion/src):
- CameraImage 9 kiểu (presets.ts CAMERA)      → zoompan (ảnh) / scale+crop (video nền)
- MOOD_GRADE (CSS filter)                     → eq + hue + colorbalance
- Vignette / FilmGrain / FlashHit             → vignette / noise / fade-in trắng
- KaraokeCaption (tô chữ từng từ, giữa-trái)  → phụ đề ASS tag \\kf từ wordTimings
- Waveform 32 thanh giữa-dưới                 → ASS drawing mode vẽ theo biên độ wav thật
Encode: h264_nvenc (GPU) nếu có, fallback libx264 veryfast. crf/cq giữ chất lượng cao.
"""
import os
import re
import json
import math
import shutil
import threading
import subprocess
import urllib.request

W, H, FPS = 1280, 720, 30
SUP = 2                       # supersample zoompan (né rung)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")

# ---- map preset (đồng bộ remotion/src/presets.ts) ----
PRESETS = {
    "calm":     dict(camera="slowPushIn",    transition="linearBlur", mood="neutral",  vignette=0.10, grain=0.035, shake=0,   flash=False),
    "happy":    dict(camera="panRight",      transition="fade",       mood="happy",    vignette=0.08, grain=0.030, shake=0,   flash=False),
    "romantic": dict(camera="diagonalPush",  transition="dreamyZoom", mood="romantic", vignette=0.08, grain=0.040, shake=0,   flash=False),
    "sad":      dict(camera="slowPullOut",   transition="dissolve",   mood="sad",      vignette=0.22, grain=0.045, shake=0,   flash=False),
    "memory":   dict(camera="slowPushIn",    transition="filmBurn",   mood="memory",   vignette=0.12, grain=0.060, shake=0,   flash=False),
    "mystery":  dict(camera="staticTension", transition="linearBlur", mood="mystery",  vignette=0.32, grain=0.050, shake=0,   flash=False),
    "tension":  dict(camera="staticTension", transition="linearBlur", mood="mystery",  vignette=0.38, grain=0.050, shake=0.5, flash=False),
    "danger":   dict(camera="impactZoom",    transition="crossZoom",  mood="danger",   vignette=0.40, grain=0.055, shake=2,   flash=False),
    "reveal":   dict(camera="impactZoom",    transition="pushCut",    mood="danger",   vignette=0.42, grain=0.050, shake=2,   flash=True),
    "horror":   dict(camera="staticTension", transition="dissolve",   mood="horror",   vignette=0.45, grain=0.070, shake=0.8, flash=False),
}
TRANS_FRAMES = {"pushCut": 8, "fade": 12, "dissolve": 12, "linearBlur": 12, "wipe": 12,
                "crossZoom": 14, "dreamyZoom": 18, "filmBurn": 20}

# CSS filter → ffmpeg (xấp xỉ trung thực; CSS brightness nhân → eq brightness cộng)
MOOD_FILTERS = {
    "neutral":  "",
    "happy":    "eq=brightness=0.02:saturation=1.18,colorbalance=rs=.02:bs=-.02",
    "romantic": "eq=brightness=0.02:saturation=1.12:contrast=0.98,colorbalance=rs=.04:bs=-.03",
    "sad":      "eq=brightness=-0.02:saturation=0.68:contrast=1.03",
    "mystery":  "eq=brightness=-0.045:saturation=0.9:contrast=1.1,hue=h=-8",
    "danger":   "eq=brightness=-0.045:saturation=1.06:contrast=1.22",
    "memory":   "eq=brightness=0.01:saturation=0.82:contrast=0.95,colorbalance=rs=.08:gs=.02:bs=-.06",
    "horror":   "eq=brightness=-0.09:saturation=0.55:contrast=1.18,hue=h=-10",
}


def preset_of(scene):
    p = dict(PRESETS.get(scene.get("preset") or "calm", PRESETS["calm"]))
    inten = float(scene.get("intensity") or 0.4)
    p["vignette"] = min(0.55, p["vignette"] + inten * 0.15)
    p["shake"] = p["shake"] * (0.6 + inten)
    return p


_ENC = None


def encoder_args():
    """Chọn encoder: NVENC (GPU cứng) nếu THẬT SỰ chạy được (probe encode thử — driver cũ sẽ fail),
    fallback libx264 veryfast. Chất lượng cao (cq/crf ~18-21)."""
    global _ENC
    if _ENC is None:
        _ENC = "x264"
        try:
            r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                                "-f", "lavfi", "-t", "0.2", "-i", "testsrc2=s=256x144:r=30",
                                "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "21",
                                "-f", "null", os.devnull],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0 and "error" not in (r.stderr or "").lower():
                _ENC = "nvenc"
        except Exception:
            pass
    if _ENC == "nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "21", "-b:v", "0",
                "-pix_fmt", "yuv420p"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-threads", os.environ.get("FFMPEG_X264_THREADS", "4")]


# GeForce (GTX 1080…) giới hạn ~3-5 phiên NVENC cùng lúc → cửa xoay: hết slot thì dùng x264,
# máy nhiều nhân (Xeon 56 luồng) chạy song song NVENC + x264 cùng lúc = nhanh nhất.
_NV_SEM = threading.BoundedSemaphore(int(os.environ.get("NVENC_SESSIONS", "4")))


def encoder_slot():
    """Trả (args, release_fn). NVENC nếu probe OK và còn slot; hết slot/không có → x264."""
    encoder_args()                          # đảm bảo đã probe
    if _ENC == "nvenc" and _NV_SEM.acquire(blocking=False):
        released = {"v": False}

        def _rel():
            if not released["v"]:
                released["v"] = True
                _NV_SEM.release()
        return (["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "21", "-b:v", "0",
                 "-pix_fmt", "yuv420p"], _rel)
    return (["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
             "-threads", os.environ.get("FFMPEG_X264_THREADS", "4")], lambda: None)


# ============================ CAMERA (zoompan) ============================
def _cam_exprs(kind, frames, shake=0.0):
    """Trả (z, x, y) expr cho zoompan. P = tiến độ 0..1. Input đã scale SUP× nên pan px ×SUP."""
    P = f"(on/{max(1, frames - 1)})"
    s = SUP

    def xy(px, py, extra_x=""):
        x = f"(iw-iw/zoom)/2+({px})*{s}{extra_x}"
        y = f"(ih-ih/zoom)/2+({py})*{s}"
        return x, y

    if kind == "slowPullOut":
        z = f"1.14-0.10*{P}"; x, y = xy(f"10*{P}", f"5*{P}")
    elif kind == "panLeft":
        z = "1.10"; x, y = xy(f"-46*{P}", f"-6*{P}")
    elif kind == "panRight":
        z = "1.10"; x, y = xy(f"46*{P}", f"-6*{P}")
    elif kind == "panUp":
        z = "1.10"; x, y = xy("0", f"-40*{P}")
    elif kind == "panDown":
        z = "1.10"; x, y = xy("0", f"40*{P}")
    elif kind == "diagonalPush":
        z = f"1.03+0.11*{P}"; x, y = xy(f"-34*{P}", f"-20*{P}")
    elif kind == "staticTension":
        z = f"1.06+0.02*{P}"; x, y = xy(f"3*sin({P}*PI)", "0")
    elif kind == "impactZoom":
        z = f"1.0+0.09*min(1,{P}*2.2)"; x, y = xy("0", "0")
    else:  # slowPushIn
        z = f"1.03+0.10*{P}"; x, y = xy(f"-12*{P}", f"-7*{P}")
    if shake:
        x += f"+{shake:.2f}*{s}*sin(on*2.7)"
        y += f"+{shake:.2f}*{s}*cos(on*3.3)"
    return z, x, y


def _cam_end(kind):
    """Vị trí camera tại P=1 (dựng ảnh tĩnh khung cuối cho transition)."""
    table = {
        "slowPushIn": (1.13, -12, -7), "slowPullOut": (1.04, 10, 5),
        "panLeft": (1.10, -46, -6), "panRight": (1.10, 46, -6),
        "panUp": (1.10, 0, -40), "panDown": (1.10, 0, 40),
        "diagonalPush": (1.14, -34, -20), "staticTension": (1.08, 0, 0),
        "impactZoom": (1.09, 0, 0),
    }
    return table.get(kind, (1.13, -12, -7))


# ============================ ASS (karaoke + waveform) ============================
def _ass_time(t):
    t = max(0.0, t)
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _clean(w):
    return re.sub(r"[^\wÀ-ỹ]", "", w, flags=re.UNICODE).lower()


# Chữ viết KHÔNG dấu cách (Trung/Nhật/Thái/Lào/Miến/Khmer): token dài phải bẻ thành cụm nhỏ,
# nếu không cả bài = 1 "từ" → phụ đề tràn màn hình.
_NOSPACE_RE = re.compile(r'[一-鿿㐀-䶿぀-ヿ豈-﫿฀-๿຀-໿က-႟ក-៿]')


def _tokens(text):
    """Tách text thành 'từ' cho karaoke: có dấu cách → split thường; cụm CJK/Thái dài → cắt 2 ký tự."""
    out = []
    for t in (text or "").strip().split():
        if len(t) > 4 and _NOSPACE_RE.search(t):
            for i in range(0, len(t), 2):
                out.append(t[i:i + 2])
        else:
            out.append(t)
    return out


WORDS_PER_PAGE = 24


def build_ass(scene, amps, path):
    """ASS 2 style: Cap (karaoke \\kf, giữa-trái như KaraokeCaption) + Wave (32 thanh vẽ mỗi khung)."""
    dur = max(1, int(scene.get("durationInFrames") or 60)) / FPS
    words = _tokens(scene.get("text") or "")   # CJK/Thái: bẻ cụm 2 ký tự, tránh 1 'từ' khổng lồ
    wt = scene.get("wordTimings") or []
    if len(wt) != len(words) or not words:
        wt = [i * dur / max(1, len(words)) for i in range(len(words))]  # nội suy tuyến tính
    kws = [_clean(x) for k in (scene.get("keywords") or []) for x in str(k.get("text", k) if isinstance(k, dict) else k).split()]
    kws = [k for k in kws if len(k) > 1]

    L = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
         "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
         "[V4+ Styles]",
         "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
         "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
         "Alignment, MarginL, MarginR, MarginV, Encoding",
         # Chữ: trắng khi đọc xong; chưa đọc trắng mờ (alpha 96); viền đen mềm + bóng đậm cho nổi trên nền
         f"Style: Cap,Segoe UI,42,&H00FFFFFF,&H96FFFFFF,&H64000000,&H50000000,1,0,0,0,100,100,1,0,1,2.4,3,4,84,{int(W*0.44)},40,163",
         # Sóng: #7fc8ff (ASS BGR = FFC87F), opacity ~.92 (alpha 14)
         "Style: Wave,Arial,20,&H14FFC87F,&H14FFC87F,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,163",
         "", "[Events]",
         "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]

    # --- karaoke theo trang 24 từ ---
    for pstart in range(0, len(words), WORDS_PER_PAGE):
        page = words[pstart:pstart + WORDS_PER_PAGE]
        t0 = wt[pstart]
        t1 = wt[pstart + WORDS_PER_PAGE] if pstart + WORDS_PER_PAGE < len(words) else dur
        parts = ["{\\blur1.5}{\\fad(120,0)}"]
        for i, w in enumerate(page):
            gi = pstart + i
            tw0 = wt[gi]
            tw1 = wt[gi + 1] if gi + 1 < len(words) else dur
            cs = max(1, int(round((tw1 - tw0) * 100)))
            gold = _clean(w) and any(k and (k in _clean(w) or _clean(w) in k) for k in kws)
            if gold:
                parts.append(f"{{\\1c&H6BD3FF&\\kf{cs}}}{w} {{\\1c&HFFFFFF&}}")
            else:
                parts.append(f"{{\\kf{cs}}}{w} ")
        L.append(f"Dialogue: 1,{_ass_time(t0)},{_ass_time(min(t1, dur))},Cap,,0,0,0,,{''.join(parts).rstrip()}")

    # --- waveform 32 thanh (đối xứng), vẽ drawing-mode mỗi khung ---
    if amps is not None and len(amps):
        bar_w, gap = 5, 4
        total_w = 32 * bar_w + 31 * gap
        x0 = (W - total_w) / 2
        cy = H * 0.91 - H * 0.13 / 2          # tâm vùng (bottom 9%, cao 13%)
        max_h = H * 0.13
        nfr = min(len(amps), int(dur * FPS) + 1)
        for f in range(nfr):
            half = amps[f]                     # 16 giá trị 0..1
            bars = list(reversed(half)) + list(half)
            t0 = f / FPS; t1 = (f + 1) / FPS
            d = []
            for i, v in enumerate(bars):
                hh = max(0.04, min(1.0, v)) * max_h / 2
                x1 = x0 + i * (bar_w + gap)
                d.append(f"m {x1:.0f} {cy - hh:.0f} l {x1 + bar_w:.0f} {cy - hh:.0f} "
                         f"{x1 + bar_w:.0f} {cy + hh:.0f} {x1:.0f} {cy + hh:.0f}")
            L.append(f"Dialogue: 0,{_ass_time(t0)},{_ass_time(t1)},Wave,,0,0,0,,{{\\p1\\blur1}}{' '.join(d)}{{\\p0}}")

    with open(path, "w", encoding="utf-8-sig") as fh:
        fh.write("\n".join(L))
    return path


def wave_amps(wav_path, frames):
    """Biên độ 16 dải tần/khung từ wav (thay useAudioData+FFT của Remotion). Trả [[16 float 0..1]...]."""
    try:
        import soundfile as sf
        import numpy as np
        data, sr = sf.read(wav_path)
        if getattr(data, "ndim", 1) > 1:
            data = data.mean(axis=1)
        win = 1024
        out = []
        for f in range(frames):
            c = int(f / FPS * sr)
            seg = data[max(0, c - win // 2): c + win // 2]
            if len(seg) < 64:
                out.append([0.0] * 16); continue
            mag = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))[1:257]
            bands = np.array_split(mag, 16)
            out.append([float(b.mean()) for b in bands])
        arr = np.array(out)
        norm = np.percentile(arr, 97) or 1.0
        arr = np.clip(arr / max(norm, 1e-6) * 1.6, 0, 1)   # gain để sóng "nhảy" như visualizeAudio
        return arr.tolist()
    except Exception:
        return [[0.15] * 16 for _ in range(frames)]


# ============================ DỰNG CẢNH ============================
def _esc_filter_path(p):
    p = p.replace("\\", "/")
    return p.replace(":", "\\:").replace("'", "\\'")


def _bg_chain(scene, frames, local):
    """Filter chain nền: ảnh → zoompan; video → scale/crop (loop)."""
    p = preset_of(scene)
    if scene.get("videoUrl"):
        chain = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                 f"crop={W}:{H},fps={FPS},setsar=1")
    else:
        z, x, y = _cam_exprs(p["camera"], frames, p["shake"])
        chain = (f"scale={W * SUP}:{H * SUP}:force_original_aspect_ratio=increase,"
                 f"crop={W * SUP}:{H * SUP},"
                 f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={W}x{H}:fps={FPS},setsar=1")
    mood = MOOD_FILTERS.get(p["mood"], "")
    if mood:
        chain += "," + mood
    ang = 0.35 + p["vignette"] * 1.15          # PI/5≈0.63 vùng dịu → mạnh dần
    chain += f",vignette=a={ang:.2f}"
    n = max(4, int(p["grain"] * 130))
    chain += f",noise=alls={n}:allf=t+u"
    if p["flash"]:
        chain += ",fade=t=in:st=0:d=0.17:c=white"
    return chain


def render_scene(scene, wav_path, bg_local, out_path, prev_still=None, workdir=None, enc=None,
                 ass_content=None):
    """Render 1 cảnh → mp4 (video+voice). prev_still = png khung cuối cảnh trước (transition dissolve).
    ass_content: ASS dựng sẵn (worker cloud nhận từ app, khỏi cần numpy/soundfile)."""
    frames = max(30, int(scene.get("durationInFrames") or 120))
    dur = frames / FPS
    wd = workdir or os.path.dirname(out_path)
    ass = os.path.join(wd, os.path.basename(out_path) + ".ass")
    if ass_content:
        with open(ass, "w", encoding="utf-8-sig") as fh:
            fh.write(ass_content)
    else:
        amps = scene.get("_amps")
        if amps is None and wav_path and os.path.exists(wav_path):
            amps = wave_amps(wav_path, frames)
        build_ass(scene, amps, ass)

    args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    is_video = bool(scene.get("videoUrl"))
    if is_video:
        args += ["-stream_loop", "-1", "-t", f"{dur:.3f}", "-i", bg_local]
    else:
        args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", bg_local]
    if wav_path and os.path.exists(wav_path):
        args += ["-i", wav_path]
        a_in = 1
    else:
        args += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=44100:cl=mono"]
        a_in = 1
    tin = None
    if prev_still and os.path.exists(prev_still):
        args += ["-loop", "1", "-framerate", str(FPS), "-i", prev_still]
        tin = 2

    fc = f"[0:v]{_bg_chain(scene, frames, bg_local)},subtitles='{_esc_filter_path(ass)}'[v0]"
    vmap = "[v0]"
    if tin is not None:
        tf = TRANS_FRAMES.get(preset_of(scene)["transition"], 12) / FPS
        fc += (f";[{tin}:v]scale={W}:{H},setsar=1,format=yuva420p,"
               f"fade=t=out:st=0:d={tf:.3f}:alpha=1[pv];"
               f"[v0][pv]overlay=eof_action=pass[vt]")
        vmap = "[vt]"
    fc += f";[{a_in}:a]aresample=44100,apad,atrim=0:{dur:.3f}[a]"

    base = args + ["-filter_complex", fc, "-map", vmap, "-map", "[a]",
                   "-t", f"{dur:.3f}", "-r", str(FPS)]
    tail = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", out_path]
    if enc is not None:
        vargs, rel = enc, (lambda: None)
    else:
        vargs, rel = encoder_slot()         # NVENC nếu còn slot, else x264
    try:
        r = subprocess.run(base + vargs + tail, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=1200)
    finally:
        rel()
    if (r.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) == 0) \
            and "nvenc" in " ".join(vargs):
        # NVENC hết session/lỗi driver giữa chừng → thử lại bằng x264 (tự chữa)
        x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                "-threads", os.environ.get("FFMPEG_X264_THREADS", "4")]
        r = subprocess.run(base + x264 + tail, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=1200)
    if r.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise RuntimeError("ffmpeg cảnh lỗi: " + (r.stderr or "")[-400:])
    return out_path


def render_last_still(scene, bg_local, out_png):
    """Ảnh tĩnh khung CUỐI của cảnh (bg + grade + vignette, KHÔNG chữ) — cho transition cảnh sau."""
    p = preset_of(scene)
    if scene.get("videoUrl"):
        chain = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
        src = ["-sseof", "-0.2", "-i", bg_local]
    else:
        s1, px, py = _cam_end(p["camera"])
        cw = int(W / s1); ch = int(H / s1)
        ox = int((W * SUP - cw * SUP) / 2 + px * SUP)
        oy = int((H * SUP - ch * SUP) / 2 + py * SUP)
        chain = (f"scale={W * SUP}:{H * SUP}:force_original_aspect_ratio=increase,"
                 f"crop={W * SUP}:{H * SUP},"
                 f"crop={cw * SUP}:{ch * SUP}:{max(0, ox)}:{max(0, oy)},scale={W}:{H}")
        src = ["-i", bg_local]
    mood = MOOD_FILTERS.get(p["mood"], "")
    if mood:
        chain += "," + mood
    chain += f",vignette=a={0.35 + p['vignette'] * 1.15:.2f}"
    r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + src +
                       ["-vf", chain, "-frames:v", "1", out_png],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0 or not os.path.exists(out_png):
        return None
    return out_png


# ============================ TẢI ASSET + GHÉP ============================
def fetch_asset(url, dest):
    if not url:
        return None
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    return dest


def concat_clips(clips, out_path, bgm=None):
    """Ghép clip (-c copy, tức thì). Có BGM → trộn thêm 1 pass (video vẫn copy)."""
    wd = os.path.dirname(out_path)
    lst = os.path.join(wd, "concat.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for c in clips:
            f.write("file '" + c.replace("\\", "/") + "'\n")
    tmp = out_path if not bgm else os.path.join(wd, "_nobgm.mp4")
    r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                        "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", tmp],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError("concat lỗi: " + (r.stderr or "")[-300:])
    if bgm:
        r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                            "-i", tmp, "-stream_loop", "-1", "-i", bgm,
                            "-filter_complex", "[1:a]volume=0.14[b];[0:a][b]amix=inputs=2:duration=first[a]",
                            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
                            out_path], capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            shutil.copyfile(tmp, out_path)
    return out_path
