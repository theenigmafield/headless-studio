# Changelog

## 0.3.0 (2026-10-31)
- Projects: a tab per project folder, plus **＋ Projects** with a native folder picker, a paste-a-path
  box and a Recent list. Each project remembers its script, take folder and last open folder.
  Close, rename, forget; no switching mid-take; a missing folder is flagged instead of recreated.
- 0.2 settings become the first project automatically (scoped to the project's own folder when the
  take folder and script share one).
- Opening a project no longer creates an empty take folder; it appears with the first recording.
- If the screen is newer than the running backend (Hermes loads plugin backends when the gateway starts), Studio says to restart the gateway and where the button is, instead of suggesting the plugin is off. `/health` reports the backend version.
- Tests: end-to-end 54 checks (19 new for projects); `dev/test_projects.py` 36 backend checks.
- Interrupted takes rebuilt on startup keep their own time, so they sort in place instead of jumping to the top.

## 0.2.0 (2026-10-31)
- Script colours: directions orange by default with a colour picker, blue breath cues, and inline
  `**bold**`, `*italic*`, `==highlight==` and `{colour}words{/}`. Readable in light and dark themes.
- Split Scroll | Record button: the right half records and scrolls together. R is its shortcut.
- One studio setup shared by every profile; `scripts/link-all-profiles.sh`.
- Dev harness seeds a sample script; end-to-end test now has 35 checks.

## 0.1.0 (2026-10-31)
- First release: teleprompter with words-per-minute pacing, recorder, takes with notes and star,
  macOS sound controls, `studio_takes` agent tool.
