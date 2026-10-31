"""Headless Studio: teleprompter, recorder and take manager for Hermes.

The desktop half (desktop/plugin.js) is the studio UI. The backend routes live in
dashboard/plugin_api.py. This agent half gives the agent one read-only tool so it can find
the take you starred and the notes you left, for example before editing a voiceover.
"""
from __future__ import annotations

import json
from pathlib import Path

TOOLSET = "headless_studio"

SCHEMA = {
    "name": "studio_takes",
    "description": (
        "List Headless Studio recordings (takes) in a folder with their notes, length and whether the "
        "user starred one as the take to use. Read-only. Use before editing a voiceover: honour the "
        "starred take and the per-take notes; if none is starred, say so and use the newest take."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "folder": {
                "type": "string",
                "description": "Folder relative to the studio folder. Empty uses the studio's default takes folder.",
            }
        },
        "required": [],
    },
}


def _handler(args: dict, **_kw) -> str:
    try:
        from .dashboard import plugin_api as api  # type: ignore
    except Exception:  # loaded outside a package
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "hs_api", Path(__file__).parent / "dashboard" / "plugin_api.py"
        )
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
    try:
        out = api.takes(folder=(args or {}).get("folder", "") or "")
        out["studio_folder"] = str(api.root())
        out["starred"] = [t["name"] for t in out["takes"] if t["keep"]]
        return json.dumps(out, ensure_ascii=False)
    except Exception as e:  # HTTPException or IO
        return json.dumps({"error": getattr(e, "detail", None) or str(e)})


def register(ctx) -> None:
    ctx.register_tool(
        name="studio_takes",
        toolset=TOOLSET,
        schema=SCHEMA,
        handler=_handler,
        description="List Headless Studio takes with notes and the starred pick",
        emoji="🎙️",
    )
