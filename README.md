# Headless Studio

A recording studio inside [Hermes](https://hermes-agent.nousresearch.com). Read your script on a
teleprompter that paces itself to your speaking speed, record straight to disk, and keep every take
with notes and a starred pick, without leaving the chat.

## What it does

**Projects (tabs)**
- Every folder you work in is a project, shown as a tab across the top. Click a tab to switch.
- Each project remembers its own script, take folder and last open folder, so switching back puts
  you where you left off.
- **＋ Projects** opens a folder (native picker or a pasted path) and lists recent projects, newest
  first. Close a tab with × and it stays in Recent; Forget removes it from the list without touching
  any files. Double-click a tab to rename it.
- New folders get sensible defaults: takes go to `voiceover/takes` if the folder has a `voiceover`
  folder, otherwise `takes`; the script is the first `.md` or `.txt` in `script/` or `scripts/`.
- You cannot switch projects in the middle of a take. One project list is shared by every Hermes profile.

**Teleprompter**
- Auto-scroll paced in words per minute (70 to 230), with a breath pause after each line.
- A reading line, the current line lit and the rest dimmed, and a time-left estimate.
- One split button: the left half scrolls only, the right half (red dot) records and scrolls
  together after a countdown. Pause pauses both. The top Record button records only, unless you
  turn on "Top Record button also scrolls".
- Focus mode, mirror text for prompter glass, line spacing, text width, reading-line height,
  hide directions.
- Script colours: coloured directions and breath cues, plus inline bold, italic, highlight and colour.
- Keys: R record and scroll, Space scroll only, Left/Right speed, Up/Down nudge, Home, F focus, Esc.

**Recorder**
- Raw 32-bit float WAV at the mic's own sample rate, with auto gain and noise suppression off.
- Streams to disk every second. If Hermes quits mid-take, the take is rebuilt next time.
- Pause and resume inside one take. Takes are numbered and never overwritten.
- Level meter with a target zone and peak hold.

**Takes (like Voice Memos)**
- Newest first, play back, rename, a note per take, star the take to use, move to Bin.
- Notes and stars live in `takes-notes.json` beside the takes, so they travel with the project.
- The take folder is created on the first recording, never just by opening a project.

**Sound (macOS)**
- Input and output device, Mac input and output volume, mute, and a shortcut to Sound settings.

**For the agent**
- A read-only `studio_takes` tool lists takes with notes and the starred pick, so an editing agent
  uses the take you chose.

## Where it shows up

- **Left sidebar:** a Headless Studio row opens the full page.
- **Right side:** the title-bar button and the command palette (`Headless Studio: show in right side`)
  open it beside the chat.
- **Command palette:** search "studio", "teleprompter" or "record".

## Install

```bash
hermes plugins install theenigmafield/headless-studio
hermes plugins enable headless-studio
```

Restart Hermes once so the backend routes load. Then go to **Capabilities → Plugins** and switch
**Headless Studio** on: Hermes ships the screen half of a combined package switched off until you turn
it on, and the command line only enables the agent half. Open the Studio, press the gear and set your
studio folder (it only reads and writes inside that folder). The first time you record, macOS asks
whether Hermes may use the microphone.

**Every profile, one version:** clone once and run `scripts/link-all-profiles.sh`. It symlinks the
checkout into each profile's `plugins/` and enables it, so a `git pull` in the checkout updates every
profile. The studio folder setting lives in `~/.hermes/headless-studio/config.json` and is shared by
all profiles.

## Script format

Any `.md` or `.txt` opens in the teleprompter. For cues, use:

```markdown
# Title
## Line 1
> Soft and close, like you are speaking to one person.
You.
And everyone
alive beside you.
(breathe)
```

`##` starts a block, `>` lines are directions (coloured, never spoken), and `(breathe)` is a
breath cue. Plain text without headings works too; blank lines split blocks.

Inside any line you can use `**bold**`, `*italic*`, `==highlight==` and `{teal}coloured words{/}`
(orange, amber, teal, blue, pink, green, red, purple). Directions are orange by default; pick another
colour, or turn colours off, in the teleprompter's settings. Each colour has a light-theme and a
dark-theme shade, so it stays readable in any Hermes theme.

## Layout

```
plugin.yaml, __init__.py      agent half: the studio_takes tool
dashboard/plugin_api.py       backend routes at /api/plugins/headless-studio/
desktop/plugin.js             the studio UI (plain ESM, no build step)
assets/                       Lexend reading font (SIL OFL 1.1)
dev/                          browser harness, end-to-end test, backend project test
```

## Develop

```bash
HERMES_HOME=/tmp/hs-home ~/.hermes/hermes-agent/venv/bin/python dev/harness.py --root /tmp/hs-root --port 8790
# in another shell: headless Chrome with a fake mic, then the end-to-end run
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9334 \
  --user-data-dir=/tmp/hs-chrome --use-fake-device-for-media-stream --use-fake-ui-for-media-stream about:blank
node dev/e2e.mjs 9334 http://127.0.0.1:8790/ /tmp/hs-shots /tmp/hs-root
# backend project logic on its own (no browser):
~/.hermes/hermes-agent/venv/bin/python dev/test_projects.py . /tmp/hs-projects
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md).

## Licence

MIT. Lexend is under the SIL Open Font License 1.1.
