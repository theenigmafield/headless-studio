"""Headless Studio backend, mounted at ``/api/plugins/headless-studio/``.

Runs inside the Hermes gateway. It reads and writes only inside the active project's folder
(projects live in the shared config.json; each remembers its script, take folder and last open folder), streams recordings to disk as they happen, and keeps per-take notes
in a ``takes-notes.json`` beside the takes. Sound controls use macOS AppleScript and
report ``supported: false`` elsewhere.
"""
import base64
import json
import os
import re
import secrets
import shutil
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
LOCK = threading.RLock()   # re-entrant: conf() reads the project list under it too
REC: dict = {}
AUDIO = re.compile(r"\.(wav|m4a|mp3|aac|aif|aiff|flac|ogg)$", re.I)
IS_MAC = sys.platform == "darwin"
MAX_MEDIA = 40 * 1024 * 1024


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home  # type: ignore
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def _shared_home() -> Path:
    """The app-level Hermes home, so every profile shares one studio setup."""
    h = _home().resolve()
    return h.parent.parent if h.parent.name == "profiles" else h


DATA = _shared_home() / "headless-studio"
CONF = DATA / "config.json"
DEFAULTS = {"root": str(Path.home() / "Headless Studio"), "default_dest": "takes", "default_script": ""}
PROJ_KEYS = ("root", "default_dest", "default_script", "last_dir")


# ---------- projects ----------
# config.json: {"projects": [{id, name, root, default_dest, default_script, last_dir, open, opened}], "active": id}
# Every project is its own folder with its own script, take folder and last open folder; "open" ones show as tabs.

def _read() -> dict:
    try:
        return json.loads(CONF.read_text())
    except Exception:
        return {}


def _write(c: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = CONF.with_suffix(".tmp")
    tmp.write_text(json.dumps(c, indent=1))
    tmp.replace(CONF)


def _migrate(c: dict) -> dict:
    """0.2 kept one root/dest/script. Turn it into the first project, scoped to the project's own folder
    when the take folder and the script share a top folder (Projects + "My reel/..." -> "My reel")."""
    if "projects" in c:
        return c
    if not c.get("root"):
        return {"projects": [], "active": None}
    root_p = Path(os.path.expanduser(c["root"]))
    dest, script = c.get("default_dest", "takes") or "", c.get("default_script", "") or ""
    heads = {x.split("/", 1)[0] for x in (dest, script) if "/" in x}
    if len(heads) == 1 and (root_p / next(iter(heads))).is_dir():
        h = next(iter(heads))
        root_p = root_p / h
        dest = dest.split("/", 1)[1] if dest.startswith(h + "/") else dest
        script = script.split("/", 1)[1] if script.startswith(h + "/") else script
    pr = {"id": secrets.token_hex(4), "name": root_p.name, "root": str(root_p), "default_dest": dest,
          "default_script": script, "last_dir": "", "open": True, "opened": time.time()}
    return {"projects": [pr], "active": pr["id"]}


def _state() -> dict:
    with LOCK:
        raw = _read()
        c = _migrate(raw)
        if c is not raw and c["projects"]:
            _write(c)
        return c


def active_project() -> Optional[dict]:
    c = _state()
    return next((p for p in c["projects"] if p["id"] == c.get("active")), None)


def conf() -> dict:
    p = active_project() or {}
    return {**DEFAULTS, **{k: p[k] for k in PROJ_KEYS if p.get(k) is not None}, "project": p.get("id"), "name": p.get("name")}


def root() -> Path:
    c = conf()
    r = Path(os.path.expanduser(c["root"])).resolve()
    if not c.get("project"):               # no project yet: the default "Headless Studio" folder
        r.mkdir(parents=True, exist_ok=True)
    elif not r.is_dir():
        raise HTTPException(404, f"the folder for {c.get('name')} is missing: {r}")
    return r


def safe(rel: Optional[str]) -> Path:
    r = root()
    p = (r / (rel or "").lstrip("/")).resolve()
    if p != r and r not in p.parents:
        raise HTTPException(403, "outside the studio folder")
    return p


def rel(p: Path) -> str:
    r = root()
    return "" if p == r else p.relative_to(r).as_posix()


# ---------- WAV helpers ----------
def wav_header(n_bytes: int, rate: int) -> bytes:
    """32-bit float mono WAV header with a fact chunk."""
    ba = 4
    fmt = struct.pack("<HHIIHHH", 3, 1, rate, rate * ba, ba, 32, 0)
    fact = struct.pack("<I", n_bytes // ba)
    riff = 4 + (8 + len(fmt)) + (8 + len(fact)) + (8 + n_bytes)
    return (b"RIFF" + struct.pack("<I", riff) + b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt
            + b"fact" + struct.pack("<I", 4) + fact + b"data" + struct.pack("<I", n_bytes))


def wav_seconds(p: Path) -> Optional[float]:
    try:
        with open(p, "rb") as f:
            if f.read(4) != b"RIFF":
                return None
            f.read(8)
            byte_rate = None
            while True:
                hd = f.read(8)
                if len(hd) < 8:
                    return None
                cid, sz = hd[:4], struct.unpack("<I", hd[4:])[0]
                if cid == b"fmt ":
                    byte_rate = struct.unpack("<I", f.read(sz)[8:12])[0]
                    if sz & 1:
                        f.read(1)
                elif cid == b"data":
                    return round(sz / byte_rate, 2) if byte_rate else None
                else:
                    f.seek(sz + (sz & 1), 1)
    except Exception:
        return None


def recover(folder: Path) -> None:
    """Rebuild takes whose recording was interrupted (panel closed, app quit)."""
    active = {r["raw"] for r in REC.values()}
    for raw in folder.glob("*.wav.recording"):
        if str(raw) in active:
            continue
        rate_f = Path(str(raw) + ".rate")
        rate = int(rate_f.read_text()) if rate_f.exists() else 48000
        when = raw.stat().st_mtime                  # last audio written: keeps the take in its place in the list
        data = raw.read_bytes()
        fin = Path(str(raw)[: -len(".wav.recording")] + " (recovered).wav")
        fin.write_bytes(wav_header(len(data), rate) + data)
        os.utime(fin, (when, when))
        raw.unlink()
        rate_f.unlink(missing_ok=True)


def next_take(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    nums = [int(m.group(1)) for f in os.listdir(folder) for m in [re.search(r"take (\d+)", f)] if m]
    return folder / (time.strftime("%Y-%m-%d %H%M") + f" take {max(nums, default=0) + 1:02d}.wav")


NOTES = "takes-notes.json"


def load_notes(folder: Path) -> dict:
    try:
        return json.loads((folder / NOTES).read_text())
    except Exception:
        return {}


def save_notes(folder: Path, notes: dict) -> None:
    tmp = folder / (NOTES + ".tmp")
    tmp.write_text(json.dumps(notes, indent=1, ensure_ascii=False))
    os.replace(tmp, folder / NOTES)


def to_trash(p: Path) -> None:
    trash = Path.home() / ".Trash" if IS_MAC else root() / ".trash"
    trash.mkdir(exist_ok=True)
    tgt, k = trash / p.name, 2
    while tgt.exists():
        tgt = trash / f"{p.stem} ({k}){p.suffix}"
        k += 1
    shutil.move(str(p), str(tgt))


# ---------- sound (macOS) ----------
_dev_cache = {"t": 0.0, "inputs": [], "outputs": [], "default_in": "", "default_out": ""}


def osa(script: str) -> str:
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=10).stdout.strip()


def sound_info() -> dict:
    if not IS_MAC:
        return {"supported": False}
    if time.time() - _dev_cache["t"] > 30:
        try:
            d = json.loads(subprocess.run(["system_profiler", "SPAudioDataType", "-json"],
                                          capture_output=True, text=True, timeout=20).stdout)
            ins, outs, din, dout = [], [], "", ""
            for grp in d.get("SPAudioDataType", []):
                for it in grp.get("_items", []):
                    if it.get("coreaudio_device_input"):
                        ins.append(it.get("_name"))
                        if it.get("coreaudio_default_audio_input_device") == "spaudio_yes":
                            din = it.get("_name")
                    if it.get("coreaudio_device_output"):
                        outs.append(it.get("_name"))
                        if it.get("coreaudio_default_audio_output_device") == "spaudio_yes":
                            dout = it.get("_name")
            _dev_cache.update(t=time.time(), inputs=ins, outputs=outs, default_in=din, default_out=dout)
        except Exception:
            pass
    vs = osa("get volume settings")
    g = lambda k: (m.group(1).strip() if (m := re.search(k + r":\s*([^,\n]+)", vs)) else "")
    num = lambda v: int(v) if v.isdigit() else None
    return {"supported": True, "inputs": _dev_cache["inputs"], "outputs": _dev_cache["outputs"],
            "default_in": _dev_cache["default_in"], "default_out": _dev_cache["default_out"],
            "input_volume": num(g("input volume")), "output_volume": num(g("output volume")),
            "muted": g("output muted") == "true"}


# ---------- request bodies ----------
class ConfBody(BaseModel):
    root: Optional[str] = None
    default_dest: Optional[str] = None
    default_script: Optional[str] = None


class ProjAdd(BaseModel):
    path: str
    name: Optional[str] = None


class ProjId(BaseModel):
    id: str


class ProjUpdate(BaseModel):
    id: str
    name: Optional[str] = None
    open: Optional[bool] = None
    default_dest: Optional[str] = None
    default_script: Optional[str] = None
    last_dir: Optional[str] = None


class PathBody(BaseModel):
    path: str


class NoteBody(BaseModel):
    path: str
    note: Optional[str] = None
    keep: Optional[bool] = None


class RenameBody(BaseModel):
    path: str
    name: str


class SoundBody(BaseModel):
    input_volume: Optional[int] = None
    output_volume: Optional[int] = None
    muted: Optional[bool] = None


class StartBody(BaseModel):
    folder: Optional[str] = None
    rate: int = 48000


class ChunkBody(BaseModel):
    id: str
    seq: int
    data: str  # base64 of little-endian float32 mono samples


class IdBody(BaseModel):
    id: str


# ---------- routes ----------
@router.get("/health")
def health() -> dict:
    return {"ok": True, "plugin": "headless-studio", "root": str(root()), "platform": sys.platform}


@router.get("/font")
def font() -> dict:
    """Lexend (SIL OFL 1.1), the reading font for the teleprompter."""
    f = Path(__file__).resolve().parent.parent / "assets" / "Lexend.ttf"
    if not f.exists():
        raise HTTPException(404, "font not bundled")
    return {"url": "data:font/ttf;base64," + base64.b64encode(f.read_bytes()).decode()}


def _check_root(path: str) -> Path:
    p = Path(os.path.expanduser(path.strip())).resolve()
    if p == Path.home() or str(p) == "/" or _home().resolve() in [p, *p.parents] or _shared_home().resolve() in [p, *p.parents]:
        raise HTTPException(400, "choose a project folder, not your home folder or Hermes' own folder")
    if p.exists() and not p.is_dir():
        raise HTTPException(400, "that is a file; choose its folder")
    return p


def _guess(p: Path) -> dict:
    """Where takes go and which script to open, for a folder Studio has not seen before."""
    dest = "voiceover/takes" if (p / "voiceover").is_dir() else "takes"
    script = ""
    for d in (p / "script", p / "scripts", p):
        if d.is_dir():
            cands = sorted(f for f in d.iterdir() if f.is_file() and f.suffix.lower() in (".md", ".txt") and not f.name.startswith("."))
            pick = next((f for f in cands if re.search(r"read|script|prompt", f.name, re.I)), None) or (cands[0] if d != p and cands else None)
            if pick:
                script = pick.relative_to(p).as_posix()
                break
    return {"default_dest": dest, "default_script": script}


def _busy() -> None:
    if REC:
        raise HTTPException(409, "a take is recording; stop it before switching projects")


@router.get("/config")
def get_config() -> dict:
    return {**conf(), "root_resolved": str(root())}


@router.post("/config")
def set_config(body: ConfBody) -> dict:
    """Change the ACTIVE project's folder, take folder or script. A new folder is added as a project instead."""
    if body.root is not None:
        add_project(ProjAdd(path=body.root))
    with LOCK:
        c = _migrate(_read())
        p = next((x for x in c["projects"] if x["id"] == c.get("active")), None)
        if p is None:
            raise HTTPException(400, "add a project folder first")
        for k in ("default_dest", "default_script"):
            v = getattr(body, k)
            if v is not None:
                p[k] = v
        _write(c)
    return get_config()


def _public(c: dict) -> dict:
    out = []
    seq = {p["id"]: i for i, p in enumerate(c["projects"])}     # tab order = order added
    for p in sorted(c["projects"], key=lambda x: -x.get("opened", 0)):
        out.append({**p, "seq": seq[p["id"]], "exists": Path(os.path.expanduser(p["root"])).is_dir(), "active": p["id"] == c.get("active")})
    return {"active": c.get("active"), "projects": out, "recording": bool(REC)}


@router.get("/projects")
def projects() -> dict:
    return _public(_state())


@router.post("/projects/add")
def add_project(body: ProjAdd) -> dict:
    _busy()
    p = _check_root(body.path)
    if not p.is_dir():
        raise HTTPException(404, "no such folder: " + str(p))
    with LOCK:
        c = _migrate(_read())
        hit = next((x for x in c["projects"] if Path(os.path.expanduser(x["root"])).resolve() == p), None)
        if hit is None:
            hit = {"id": secrets.token_hex(4), "name": (body.name or p.name).strip()[:60], "root": str(p), "last_dir": "", **_guess(p)}
            c["projects"].append(hit)
        hit.update(open=True, opened=time.time())
        c["active"] = hit["id"]
        _write(c)
        return _public(c)


@router.post("/projects/activate")
def activate_project(body: ProjId) -> dict:
    _busy()
    with LOCK:
        c = _migrate(_read())
        hit = next((x for x in c["projects"] if x["id"] == body.id), None)
        if hit is None:
            raise HTTPException(404, "unknown project")
        if not Path(os.path.expanduser(hit["root"])).is_dir():
            raise HTTPException(404, f"the folder for {hit['name']} is missing: {hit['root']}")
        hit.update(open=True, opened=time.time())
        c["active"] = hit["id"]
        _write(c)
        return _public(c)


@router.post("/projects/update")
def update_project(body: ProjUpdate) -> dict:
    """Rename, close/reopen a tab, or remember the project's script / take folder / last open folder."""
    with LOCK:
        c = _migrate(_read())
        hit = next((x for x in c["projects"] if x["id"] == body.id), None)
        if hit is None:
            raise HTTPException(404, "unknown project")
        if body.name is not None and body.name.strip():
            hit["name"] = body.name.strip()[:60]
        for k in ("default_dest", "default_script", "last_dir"):
            v = getattr(body, k)
            if v is not None:
                hit[k] = v
        if body.open is not None:
            hit["open"] = body.open
            if not body.open and c.get("active") == hit["id"]:
                if REC:
                    raise HTTPException(409, "a take is recording; stop it before closing this project")
                nxt = next((x for x in sorted(c["projects"], key=lambda x: -x.get("opened", 0)) if x.get("open") and x["id"] != hit["id"]), None)
                c["active"] = nxt["id"] if nxt else hit["id"]
                if nxt is None:
                    hit["open"] = True          # the last tab stays open
        _write(c)
        return _public(c)


@router.post("/projects/forget")
def forget_project(body: ProjId) -> dict:
    """Remove a project from the list. Its folder and files are not touched."""
    with LOCK:
        c = _migrate(_read())
        if body.id == c.get("active"):
            raise HTTPException(400, "switch to another project before forgetting this one")
        c["projects"] = [x for x in c["projects"] if x["id"] != body.id]
        _write(c)
        return _public(c)


@router.get("/list")
def list_dir(path: str = "") -> dict:
    p = safe(path)
    if not p.is_dir():
        raise HTTPException(404, "no such folder")
    ents = []
    for e in p.iterdir():
        if e.name.startswith(".") or e.name == "__pycache__" or e.name.endswith((".recording", ".rate")):
            continue
        st = e.stat()
        ents.append({"name": e.name, "dir": e.is_dir(), "size": st.st_size, "mtime": st.st_mtime, "path": rel(e)})
    ents.sort(key=lambda x: (not x["dir"], x["name"].lower()))
    return {"path": rel(p), "entries": ents}


@router.get("/text")
def read_text(path: str) -> dict:
    p = safe(path)
    if not p.is_file():
        raise HTTPException(404, "no such file")
    if p.stat().st_size > 2_000_000:
        raise HTTPException(413, "file too large to show")
    return {"text": p.read_text(errors="replace")}


@router.get("/media")
def media(path: str) -> dict:
    """A data URL for playback. Large WAVs are transcoded to AAC for the player only."""
    p = safe(path)
    if not p.is_file():
        raise HTTPException(404, "no such file")
    src, mime = p, None
    if p.suffix.lower() in (".wav", ".aif", ".aiff", ".flac"):
        cache = DATA / "preview-cache"
        cache.mkdir(parents=True, exist_ok=True)
        for old in cache.glob("*.m4a"):  # previews are disposable; keep two weeks
            if time.time() - old.stat().st_mtime > 14 * 86400:
                old.unlink(missing_ok=True)
        key = re.sub(r"[^A-Za-z0-9]+", "_", rel(p))[-150:] + f"_{int(p.stat().st_mtime)}.m4a"
        out = cache / key
        if not out.exists():
            if IS_MAC and shutil.which("afconvert"):
                cmd = ["afconvert", "-f", "m4af", "-d", "aac", "-b", "160000", str(p), str(out)]
            elif shutil.which("ffmpeg"):
                cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(p), "-c:a", "aac", "-b:a", "160k", str(out)]
            else:
                cmd = None
            if cmd and subprocess.run(cmd, capture_output=True, timeout=120).returncode == 0:
                for old in cache.glob(key.rsplit("_", 1)[0] + "_*.m4a"):
                    if old != out:
                        old.unlink(missing_ok=True)
        if out.exists():
            src, mime = out, "audio/mp4"
    if src.stat().st_size > MAX_MEDIA:
        raise HTTPException(413, "too large to preview here, use Show in Finder")
    import mimetypes
    mime = mime or mimetypes.guess_type(src.name)[0] or "application/octet-stream"
    return {"url": f"data:{mime};base64," + base64.b64encode(src.read_bytes()).decode(), "transcoded": src != p}


@router.post("/reveal")
def reveal(body: PathBody) -> dict:
    p = safe(body.path)
    if IS_MAC:
        subprocess.run(["open", "-R", str(p)])
    elif shutil.which("xdg-open"):
        subprocess.Popen(["xdg-open", str(p if p.is_dir() else p.parent)])
    return {"ok": True}


@router.get("/sound")
def get_sound() -> dict:
    return sound_info()


@router.post("/sound")
def set_sound(body: SoundBody) -> dict:
    if not IS_MAC:
        return {"supported": False}
    if body.input_volume is not None:
        osa(f"set volume input volume {max(0, min(100, int(body.input_volume)))}")
    if body.output_volume is not None:
        osa(f"set volume output volume {max(0, min(100, int(body.output_volume)))}")
    if body.muted is not None:
        osa(f"set volume output muted {'true' if body.muted else 'false'}")
    return sound_info()


@router.post("/sound/settings")
def open_sound_settings() -> dict:
    if IS_MAC:
        subprocess.run(["open", "x-apple.systempreferences:com.apple.Sound-Settings.extension?input"])
    return {"ok": IS_MAC}


@router.get("/takes")
def takes(folder: str = "") -> dict:
    f = safe(folder or conf()["default_dest"])
    if not f.is_dir():                     # created on the first recording, not by looking
        return {"folder": rel(f), "takes": []}
    with LOCK:
        recover(f)
    notes, out = load_notes(f), []
    for e in f.iterdir():
        if not AUDIO.search(e.name) or not e.is_file():
            continue
        n = notes.get(e.name, {})
        out.append({"name": e.name, "path": rel(e), "mtime": e.stat().st_mtime, "seconds": wav_seconds(e),
                    "note": n.get("note", ""), "keep": bool(n.get("keep"))})
    out.sort(key=lambda x: -x["mtime"])
    return {"folder": rel(f), "takes": out}


@router.post("/takes/note")
def take_note(body: NoteBody) -> dict:
    p = safe(body.path)
    if not p.is_file():
        raise HTTPException(404, "no such take")
    with LOCK:
        notes = load_notes(p.parent)
        n = notes.get(p.name, {})
        if body.note is not None:
            n["note"] = body.note[:4000]
        if body.keep is not None:
            n["keep"] = body.keep
        n["updated"] = time.strftime("%Y-%m-%d %H:%M")
        notes[p.name] = n
        save_notes(p.parent, notes)
    return {"ok": True, "note": n.get("note", ""), "keep": n.get("keep", False)}


@router.post("/takes/rename")
def take_rename(body: RenameBody) -> dict:
    p = safe(body.path)
    new = re.sub(r'[\\/:*?"<>|]+', " ", body.name).strip()[:120]
    if not new:
        raise HTTPException(400, "empty name")
    if not new.lower().endswith(p.suffix.lower()):
        new += p.suffix
    dst = p.parent / new
    if dst.exists():
        raise HTTPException(409, "a take with that name exists")
    with LOCK:
        p.rename(dst)
        notes = load_notes(p.parent)
        if p.name in notes:
            notes[new] = notes.pop(p.name)
            save_notes(p.parent, notes)
    return {"ok": True, "path": rel(dst)}


@router.post("/takes/trash")
def take_trash(body: PathBody) -> dict:
    p = safe(body.path)
    if not AUDIO.search(p.name) or not p.is_file():
        raise HTTPException(400, "only audio takes can be binned here")
    to_trash(p)
    return {"ok": True}


@router.post("/rec/start")
def rec_start(body: StartBody) -> dict:
    folder = safe(body.folder or conf()["default_dest"])
    final = next_take(folder)
    raw = Path(str(final) + ".recording")
    raw.write_bytes(b"")
    Path(str(raw) + ".rate").write_text(str(int(body.rate)))
    rid = secrets.token_hex(6)
    REC[rid] = {"raw": str(raw), "final": str(final), "seq": 0, "bytes": 0, "rate": int(body.rate), "rel": rel(final)}
    return {"id": rid, "file": rel(final)}


@router.post("/rec/chunk")
def rec_chunk(body: ChunkBody) -> dict:
    data = base64.b64decode(body.data)
    with LOCK:
        r = REC.get(body.id)
        if not r:
            raise HTTPException(404, "no such recording")
        if body.seq != r["seq"]:
            raise HTTPException(409, f"expected chunk {r['seq']}")
        try:
            with open(r["raw"], "ab") as f:
                f.write(data)
        except FileNotFoundError:
            raise HTTPException(410, "the take's folder was moved or deleted while recording")
        r["seq"] += 1
        r["bytes"] += len(data)
    return {"ok": True, "seconds": round(r["bytes"] / 4 / r["rate"], 2)}


@router.post("/rec/finish")
def rec_finish(body: IdBody) -> dict:
    with LOCK:
        r = REC.pop(body.id, None)
        if not r:
            raise HTTPException(404, "no such recording")
        raw, final = Path(r["raw"]), Path(r["final"])
        data = raw.read_bytes()
        final.write_bytes(wav_header(len(data), r["rate"]) + data)
        raw.unlink(missing_ok=True)
        Path(str(raw) + ".rate").unlink(missing_ok=True)
    return {"file": r.get("rel") or rel(final), "seconds": round(len(data) / 4 / r["rate"], 2)}


@router.post("/rec/discard")
def rec_discard(body: IdBody) -> dict:
    with LOCK:
        r = REC.pop(body.id, None)
        if r:
            Path(r["raw"]).unlink(missing_ok=True)
            Path(r["raw"] + ".rate").unlink(missing_ok=True)
    return {"ok": True}
