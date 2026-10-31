"""Dev harness: serve the real backend router plus a page that loads desktop/plugin.js with a
stand-in for @hermes/plugin-sdk, so the plugin can be exercised in a plain browser.

    HERMES_HOME=/tmp/hs-home python dev/harness.py --root "/path/to/a/test/folder" --port 8790

Then open http://127.0.0.1:8790/ (or drive it headless; see dev/e2e.mjs).
Needs fastapi + uvicorn (the Hermes venv has both).
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--port", type=int, default=8790)
args = ap.parse_args()

spec = importlib.util.spec_from_file_location("hs_api", REPO / "dashboard" / "plugin_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
api.DATA.mkdir(parents=True, exist_ok=True)
api.CONF.write_text(json.dumps({"root": args.root, "default_dest": "takes", "default_script": ""}))

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, Response  # noqa: E402
import uvicorn  # noqa: E402

app = FastAPI()
app.include_router(api.router, prefix="/api/plugins/headless-studio")


@app.get("/")
def index():
    return HTMLResponse((HERE / "harness.html").read_text())


@app.get("/plugin.js")
def plugin_js():
    return Response((REPO / "desktop" / "plugin.js").read_text(), media_type="text/javascript")


@app.get("/sdk-shim.js")
def shim():
    return FileResponse(HERE / "sdk-shim.js", media_type="text/javascript")


uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
