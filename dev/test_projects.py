"""Backend test for Headless Studio projects (no Hermes needed). Usage: python test_projects.py <plugin dir> <scratch>"""
import importlib.util, json, os, sys, shutil
from pathlib import Path

plug, S = Path(sys.argv[1]), Path(sys.argv[2])
shutil.rmtree(S / "home", ignore_errors=True); shutil.rmtree(S / "work", ignore_errors=True)
home = S / "home"; (home / "headless-studio").mkdir(parents=True)
os.environ["HERMES_HOME"] = str(home)
work = S / "work"
reels = work / "Reels"
(reels / "Sample reel" / "script").mkdir(parents=True)
(reels / "Sample reel" / "script" / "Reading script.md").write_text("## Line 1\nHello\n")
(reels / "Sample reel" / "voiceover" / "takes").mkdir(parents=True)
(reels / "Sample reel" / "voiceover" / "takes" / "2026-01-01 1200 take 05.wav").write_bytes(b"RIFF")
(work / "Course").mkdir(parents=True); (work / "Course" / "scripts").mkdir(); (work / "Course" / "scripts" / "Lesson 1 prompt.md").write_text("Hi")
(work / "Bare").mkdir()
# a 0.2-style config
(home / "headless-studio" / "config.json").write_text(json.dumps({"root": str(reels), "default_dest": "Sample reel/voiceover/takes",
                                                                  "default_script": "Sample reel/script/Reading script.md"}))
spec = importlib.util.spec_from_file_location("hs", plug / "dashboard" / "plugin_api.py"); api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
from fastapi import HTTPException

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    ok, fail = (ok + 1, fail) if cond else (ok, fail + 1)
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))

def raises(fn, code):
    try: fn(); return False
    except HTTPException as e: return e.status_code == code

P = api.projects()
p0 = P["projects"][0]
check("migrated to one project", len(P["projects"]) == 1, P)
check("project scoped to its own folder", p0["root"] == str(reels / "Sample reel") and p0["name"] == "Sample reel", p0)
check("dest and script made relative", p0["default_dest"] == "voiceover/takes" and p0["default_script"] == "script/Reading script.md", p0)
check("existing take still listed", [t["name"] for t in api.takes()["takes"]] == ["2026-01-01 1200 take 05.wav"])
check("config written once", "projects" in json.loads((home / "headless-studio" / "config.json").read_text()))

P = api.add_project(api.ProjAdd(path=str(work / "Course")))
c = api.conf()
check("add: becomes active", c["name"] == "Course" and P["active"] == c["project"])
check("add: guesses scripts/ prompt", c["default_script"] == "scripts/Lesson 1 prompt.md", c)
check("add: takes folder default", c["default_dest"] == "takes")
check("listing takes does not create a folder", api.takes()["takes"] == [] and not (work / "Course" / "takes").exists())
P = api.add_project(api.ProjAdd(path=str(work / "Course")))
check("adding the same folder again reuses it", sum(p["name"] == "Course" for p in P["projects"]) == 1)
api.add_project(api.ProjAdd(path=str(work / "Bare")))
check("bare folder: no script", api.conf()["default_script"] == "")

check("rejects home folder", raises(lambda: api.add_project(api.ProjAdd(path=str(Path.home()))), 400))
check("rejects Hermes folder", raises(lambda: api.add_project(api.ProjAdd(path=str(home))), 400))
check("rejects missing folder", raises(lambda: api.add_project(api.ProjAdd(path=str(work / "nope"))), 404))
check("rejects a file", raises(lambda: api.add_project(api.ProjAdd(path=str(work / "Course" / "scripts" / "Lesson 1 prompt.md"))), 400))

ids = {p["name"]: p["id"] for p in api.projects()["projects"]}
api.activate_project(api.ProjId(id=ids["Sample reel"]))
check("switch back restores folder/script/dest", api.conf()["default_script"] == "script/Reading script.md" and api.root() == (reels / "Sample reel").resolve())
check("files are scoped to the project", raises(lambda: api.safe("../Bare"), 403))
api.update_project(api.ProjUpdate(id=ids["Sample reel"], last_dir="voiceover", default_script="script/Reading script.md"))
check("remembers last open folder", api.conf()["last_dir"] == "voiceover")
api.update_project(api.ProjUpdate(id=ids["Sample reel"], name="Sample"))
check("rename", api.conf()["name"] == "Sample")

P = api.update_project(api.ProjUpdate(id=ids["Sample reel"], open=False))
act = next(p for p in P["projects"] if p["active"])
check("closing the active tab moves to the next open one", act["name"] == "Bare" and not next(p for p in P["projects"] if p["id"] == ids["Sample reel"])["open"])
P = api.activate_project(api.ProjId(id=ids["Sample reel"]))
check("reopening from recents opens its tab again", next(p for p in P["projects"] if p["id"] == ids["Sample reel"])["open"])
for n in ("Course", "Bare"): api.update_project(api.ProjUpdate(id=ids[n], open=False))
P = api.update_project(api.ProjUpdate(id=ids["Sample reel"], open=False))
check("last tab cannot be closed", next(p for p in P["projects"] if p["id"] == ids["Sample reel"])["open"])
check("cannot forget the active project", raises(lambda: api.forget_project(api.ProjId(id=ids["Sample reel"])), 400))
P = api.forget_project(api.ProjId(id=ids["Bare"]))
check("forget removes from list, keeps folder", "Bare" not in [p["name"] for p in P["projects"]] and (work / "Bare").is_dir())
check("recents newest first", [p["name"] for p in P["projects"]][0] == "Sample")

# recording guard
r = api.rec_start(api.StartBody())
check("recording goes into the active project", r["file"].startswith("voiceover/takes/"))
check("cannot switch while recording", raises(lambda: api.activate_project(api.ProjId(id=ids["Course"])), 409))
check("cannot add while recording", raises(lambda: api.add_project(api.ProjAdd(path=str(work / "Course"))), 409))
check("projects() reports recording", api.projects()["recording"] is True)
api.rec_discard(api.IdBody(id=r["id"]))
api.activate_project(api.ProjId(id=ids["Course"]))
check("switch works after the take", api.conf()["name"] == "Course")
shutil.move(str(work / "Course"), str(work / "Course moved"))
P = api.projects()
check("missing folder is flagged", next(p for p in P["projects"] if p["name"] == "Course")["exists"] is False)
check("missing folder gives a clear error", raises(lambda: api.root(), 404))
check("can't switch to a missing folder", raises(lambda: api.activate_project(api.ProjId(id=ids["Course"])), 404))
api.activate_project(api.ProjId(id=ids["Sample reel"]))
check("old /config root still works (adds a project)", api.set_config(api.ConfBody(root=str(work / "Course moved")))["name"] == "Course moved")
print(f"{ok} passed, {fail} failed")
