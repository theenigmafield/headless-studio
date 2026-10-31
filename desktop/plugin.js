// Headless Studio: record voiceovers, read from a teleprompter and keep every take with notes,
// inside Hermes. Desktop half; the backend lives in ../dashboard/plugin_api.py.
// Plain ESM, loaded uncompiled: no JSX, only @hermes/plugin-sdk and react imports.
import { host, Codicon, PANES_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, TITLEBAR_AREAS, PALETTE_AREA } from '@hermes/plugin-sdk'
import * as React from 'react'
import { jsx } from 'react/jsx-runtime'

const ID = 'headless-studio'
const VERSION = '0.2.0'
let CTX = null
let studio = null // one studio per window; the pane and the page share it

const rest = (path, opts) => CTX.rest(path, opts)
const q = s => encodeURIComponent(s ?? '')
const mmss = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)
const human = n => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B')
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const errText = e => {
  const m = String(e?.message || e)
  try { const j = JSON.parse(m.slice(m.indexOf('{'))); return j.detail || m } catch { return m }
}

const CSS = `
.hs { position: relative; height: 100%; display: flex; flex-direction: column; gap: 8px; padding: 8px; box-sizing: border-box;
  color: var(--ui-text-primary); font-size: 13px; container-type: inline-size; outline: none; }
.hs * { box-sizing: border-box; }
.hs button { font: inherit; color: var(--ui-text-secondary); background: transparent; border: 1px solid var(--ui-stroke-secondary);
  border-radius: 7px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.hs button:hover { color: var(--ui-text-primary); border-color: var(--ui-accent); }
.hs button.on { color: var(--ui-text-primary); border-color: var(--ui-accent); background: color-mix(in oklab, var(--ui-accent) 14%, transparent); }
.hs select { font: inherit; color: var(--ui-text-primary); background: transparent; border: 1px solid var(--ui-stroke-secondary); border-radius: 7px; padding: 2px 4px; min-width: 0; max-width: 100%; }
.hs input[type=range] { accent-color: var(--ui-accent); }
.hs .mut { color: var(--ui-text-tertiary); } .hs .tiny { font-size: 11px; }
.hs .card { border: 1px solid var(--ui-stroke-secondary); border-radius: 10px; }
.hs .bar { display: flex; gap: 10px; padding: 8px 10px; }
.hs .rows { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.hs .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.hs .row + .row { border-top: 1px solid var(--ui-stroke-tertiary); padding-top: 6px; }
.hs .sec { font-size: 11px; font-weight: 600; color: var(--ui-text-tertiary); min-width: 56px; }
.hs .num { min-width: 22px; font-size: 11px; color: var(--ui-text-tertiary); font-variant-numeric: tabular-nums; }
.hs .sp { flex: 1; }
.hs .meter { position: relative; width: 110px; height: 10px; border-radius: 5px; background: var(--ui-stroke-tertiary); overflow: hidden; }
.hs .meter .zone { position: absolute; top: 0; bottom: 0; background: color-mix(in oklab, var(--ui-green) 30%, transparent); }
.hs .meter .lvl { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--ui-green); }
.hs .meter .pk { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ui-text-primary); }
.hs .recbox { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding-left: 10px; border-left: 1px solid var(--ui-stroke-tertiary); min-width: 120px; }
.hs .rec { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 14px; padding: 9px 16px; border-radius: 999px; border: 2px solid var(--ui-red); color: var(--ui-text-primary); }
.hs .rec .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--ui-red); }
.hs .rec.on { background: var(--ui-red); color: var(--ui-bg-editor, white); } .hs .rec.on .dot { background: currentColor; border-radius: 2px; }
.hs .rec .t { display: none; font-variant-numeric: tabular-nums; } .hs .rec.on .t { display: inline; }
.hs .allow { font-weight: 700; padding: 9px 14px; border-radius: 999px; border: 2px solid var(--ui-accent); color: var(--ui-text-primary); }
.hs .note { padding: 8px 10px; border-radius: 9px; border: 1px solid var(--ui-stroke-secondary); color: var(--ui-text-tertiary); }
.hs .note.warn { border-color: var(--ui-red); color: var(--ui-text-primary); }
.hs .tabs { display: flex; gap: 4px; }
.hs .tabs button { flex: 1; border-color: transparent; }
.hs .tabs button.on { border-color: var(--ui-stroke-secondary); background: var(--ui-stroke-tertiary); font-weight: 600; }
.hs .main { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr; grid-template-rows: auto 1fr; gap: 8px; }
.hs .left, .hs .view { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.hs .scroll { flex: 1; min-height: 0; overflow: auto; position: relative; }
.hs .head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--ui-stroke-tertiary); font-size: 12px; color: var(--ui-text-tertiary); }
.hs .head .t { flex: 1; color: var(--ui-text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs[data-tab=script] .left, .hs:not([data-tab=script]) .view { display: none; }
@container (min-width: 760px) {
  .hs .main { grid-template-columns: 260px 1fr; grid-template-rows: 1fr; }
  .hs .left, .hs .view { display: flex !important; }
  .hs .tabs .t-script { display: none; }
  .hs .maintabs { display: none; }
  .hs .lefttabs { display: flex; }
}
.hs .maintabs { margin-bottom: 0; } .hs .lefttabs { display: none; }
.hs .ent { display: flex; gap: 7px; align-items: center; padding: 5px 8px; margin: 1px 4px; border-radius: 6px; cursor: pointer; }
.hs .ent:hover { background: var(--ui-stroke-tertiary); } .hs .ent.sel { background: color-mix(in oklab, var(--ui-accent) 16%, transparent); }
.hs .ent .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hs .crumbs { padding: 6px 10px; font-size: 11px; color: var(--ui-text-tertiary); border-bottom: 1px solid var(--ui-stroke-tertiary); }
.hs .crumbs a { color: var(--ui-text-secondary); cursor: pointer; } .hs .crumbs a:hover { color: var(--ui-accent); }
.hs .take { margin: 4px 6px; padding: 7px 9px; border-radius: 9px; border: 1px solid transparent; cursor: pointer; }
.hs .take:hover { background: var(--ui-stroke-tertiary); } .hs .take.open { border-color: var(--ui-stroke-secondary); cursor: default; background: transparent; }
.hs .take.new { border-color: var(--ui-accent); } .hs .take.live { border-color: var(--ui-red); }
.hs .take .r1 { display: flex; align-items: baseline; gap: 6px; } .hs .take .nm { font-weight: 600; flex: 1; min-width: 0; }
.hs .take .meta { color: var(--ui-text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.hs .take .np { color: var(--ui-text-tertiary); font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hs .take .star { color: var(--ui-accent); }
.hs .take input.rn { width: 100%; font: inherit; font-weight: 600; color: var(--ui-text-primary); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 1px 4px; }
.hs .take input.rn:hover, .hs .take input.rn:focus { border-color: var(--ui-stroke-secondary); outline: none; }
.hs .take textarea { width: 100%; min-height: 60px; margin-top: 6px; resize: vertical; font: inherit; font-size: 12px; color: var(--ui-text-primary); background: transparent; border: 1px solid var(--ui-stroke-secondary); border-radius: 7px; padding: 5px 7px; }
.hs .take .acts { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
.hs audio, .hs video { width: 100%; margin-top: 6px; } .hs img { max-width: 100%; border-radius: 8px; }
.hs pre { white-space: pre-wrap; font-size: 12px; padding: 10px; margin: 0; }
/* teleprompter */
.hs .tpbar { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; padding: 6px 10px; border-bottom: 1px solid var(--ui-stroke-tertiary); font-size: 12px; color: var(--ui-text-tertiary); }
.hs .tpbar .tpmain { font-weight: 700; border-color: var(--ui-accent); min-width: 84px; }
.hs .tpf { display: flex; align-items: center; gap: 5px; } .hs .tpf input { width: 74px; } .hs .tpf b { color: var(--ui-text-primary); font-weight: 600; min-width: 44px; font-variant-numeric: tabular-nums; }
.hs .tpsplit { display: inline-flex; }
.hs .tpsplit .tpPlay { border-radius: 999px 0 0 999px; border-right-width: 0; padding-left: 12px; }
.hs .tpsplit .tprec { display: inline-flex; align-items: center; gap: 6px; border-radius: 0 999px 999px 0; border-color: var(--ui-accent); padding: 3px 11px 3px 9px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hs .tpsplit .tprec:hover { border-color: var(--ui-red); background: color-mix(in oklab, var(--ui-red) 14%, transparent); }
.hs .tprec .rdot { width: 10px; height: 10px; border-radius: 50%; background: var(--ui-red); }
.hs .tprec.recording .rdot { border-radius: 2px; background: currentColor; }
.hs .tprec.recording { background: var(--ui-red); border-color: var(--ui-red); color: var(--ui-bg-editor, white); font-weight: 700; }
.hs .tpmore { position: absolute; right: 8px; top: calc(100% + 4px); z-index: 20; width: 280px; display: flex; flex-direction: column; gap: 9px; padding: 11px; border: 1px solid var(--ui-stroke-secondary); border-radius: 11px; background: var(--ui-bg-elevated); color: var(--ui-text-primary); box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.hs .tpmore[hidden] { display: none; }
.hs .tpmore label { display: flex; align-items: center; justify-content: space-between; gap: 8px; } .hs .tpmore label.ck { justify-content: flex-start; }
.hs .tpmore input[type=range] { width: 120px; }
.hs .reader { font-family: "HSLexend", var(--ui-font-sans, system-ui), sans-serif; margin: 0 auto; padding: 0 14px; }
.hs .reader h1 { font-size: .7em; margin: 0 0 8px; } .hs .reader h2 { font-size: 11px; color: var(--ui-text-tertiary); letter-spacing: .08em; text-transform: uppercase; margin: 18px 0 3px; font-weight: 600; font-family: inherit; }
.hs .reader .dir { color: var(--hs-dir, var(--ui-accent)); font-size: .6em; margin: 2px 0 5px; line-height: 1.4; }
.hs .reader b, .hs .reader strong { font-weight: 800; } .hs .reader i, .hs .reader em { font-style: italic; }
.hs .reader mark { color: inherit; background: color-mix(in oklab, var(--hs-hl, #f5c542) 38%, transparent); border-radius: 4px; padding: 0 .12em; }
.hs .reader .c { color: var(--c); }
.hs .reader.mono .dir, .hs .reader.mono .br, .hs .reader.mono .c { color: inherit; } .hs .reader.mono .dir { opacity: .7; } .hs .reader.mono mark { background: color-mix(in oklab, currentColor 18%, transparent); }
.hs .tpmore .sw { display: flex; gap: 5px; } .hs .tpmore .sw button { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid transparent; }
.hs .tpmore .sw button.on { border-color: var(--ui-text-primary); }
.hs .reader .ln { line-height: var(--ls, 1.45); font-weight: 500; }
.hs .reader .br { color: var(--hs-br, var(--ui-text-tertiary)); font-size: .45em; margin-top: 3px; }
.hs .reader .blk { padding: 5px 9px; border-radius: 10px; border-left: 3px solid transparent; cursor: pointer; opacity: .5; transition: opacity .25s, background .25s; }
.hs .reader .blk.cur { opacity: 1; background: color-mix(in oklab, var(--ui-accent) 12%, transparent); border-left-color: var(--ui-accent); }
.hs .reader.mirror { transform: scaleX(-1); } .hs .reader.nodirs .dir, .hs .reader.nodirs .br { display: none; }
.hs .tp-end { text-align: center; color: var(--ui-text-tertiary); font-size: 12px; padding: 20px 0; }
.hs .eyeline { position: absolute; left: 0; right: 0; height: 0; border-top: 2px dashed color-mix(in oklab, var(--ui-accent) 55%, transparent); pointer-events: none; z-index: 5; }
.hs .eyeline span { position: absolute; left: 2px; top: -10px; color: var(--ui-accent); font-size: 13px; }
.hs .countdown { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 110px; font-weight: 800; color: var(--ui-accent); z-index: 15; background: color-mix(in oklab, var(--ui-bg-editor, black) 55%, transparent); }
.hs.focus .bar, .hs.focus .maintabs, .hs.focus .left, .hs.focus .view .head { display: none !important; }
.hs.focus .main { grid-template-columns: 1fr !important; }
.hs.focus .view { display: flex !important; }
.hs .empty { padding: 18px; text-align: center; color: var(--ui-text-tertiary); }
`

const TP_DEF = { size: 30, wpm: 140, breath: 0.6, spacing: 1.45, width: 100, eye: 30, mirror: false, dirs: true, withRec: true, countdown: 3, colors: true, dirColor: 'orange' }

// Script colours. Each has a dark-theme and a light-theme shade so it stays readable on both.
const COLORS = {
  orange: ['#f0a04b', '#c2620a'], amber: ['#f5c542', '#a16207'], teal: ['#4fd1c5', '#0f766e'],
  blue: ['#8fb3ff', '#2f5bd3'], pink: ['#f472b6', '#be185d'], green: ['#6ee7a0', '#15803d'], red: ['#ff8080', '#c81e1e'], purple: ['#c4a5ff', '#6d28d9']
}
const BREATH = ['#8fb3ff', '#3b5bdb']
function isDarkBg(el) {
  for (let n = el; n; n = n.parentElement) {
    const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g)
    if (m && (m.length < 4 || +m[3] > 0.5)) { const [r, g, b] = m.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 }
  }
  return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches
}
// Light markdown inside a line: **bold**, *italic*, ==highlight==, {orange}coloured words{/}
function inlineMd(text, dark) {
  let h = esc(text)
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/==(.+?)==/g, '<mark>$1</mark>')
  h = h.replace(/\{(\w+)\}(.+?)\{\/\}/g, (all, name, inner) => COLORS[name] ? `<span class="c" style="--c:${COLORS[name][dark ? 0 : 1]}">${inner}</span>` : inner)
  return h
}

/* =====================================================================================
   Studio: built once, imperatively, and moved between the pane and the page.
   ===================================================================================== */
class Studio {
  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'hs'
    this.el.tabIndex = -1
    this.el.dataset.tab = 'script'
    this.state = {
      cwd: '', dest: '', script: '', selected: null, openTake: null, justSaved: null, sound: {},
      tp: { ...TP_DEF, ...(CTX.storage.get('tp', {}) || {}) }
    }
    this.mic = { ctx: null, stream: null, node: null, analyser: null, running: false, raf: 0 }
    this.rec = { id: null, buf: null, seq: 0, t0: 0, timer: null, sending: Promise.resolve(), paused: false, pausedMs: 0, pauseT: 0 }
    this.tpRun = false; this.tpCount = 0; this.tpPos = 0; this.tpSegs = []; this.tpRaf = 0; this.tpLast = 0
    this.build()
  }

  $(sel) { return this.el.querySelector(sel) }
  status(t, warn) { const s = this.$('.st'); s.textContent = t; s.style.color = warn ? 'var(--ui-red)' : '' }

  build() {
    const st = document.createElement('style'); st.textContent = CSS; this.el.appendChild(st)
    this.el.insertAdjacentHTML('beforeend', `
      <div class="card bar">
        <div class="rows">
          <div class="row"><span class="sec">🎙 Input</span><select class="dev" title="Microphone"></select>
            <span class="row" style="gap:5px" title="Mac input volume"><input class="ivol" type="range" min="0" max="100" style="width:72px"><span class="num ivt">--</span></span>
            <div class="meter" title="Aim for the green zone when you speak"><div class="zone"></div><div class="lvl"></div><div class="pk"></div></div><span class="lvltxt tiny mut">mic off</span></div>
          <div class="row"><span class="sec">🔈 Output</span><select class="out" title="Where takes play back"></select>
            <span class="row" style="gap:5px" title="Mac output volume"><input class="ovol" type="range" min="0" max="100" style="width:72px"><span class="num ovt">--</span></span>
            <button class="mute">Mute</button><span class="sp"></span><button class="sysset">Sound settings</button></div>
          <div class="row"><span class="sec">💾 Saves to</span><span class="dest tiny mut" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
            <button class="here" title="Save new takes into the folder open in Files">Use open folder</button><span class="sp"></span><button class="cfg" title="Studio folder">⚙</button></div>
          <div class="row cfgrow" style="display:none"><span class="sec">📁 Folder</span><input class="rootin" style="flex:1;min-width:160px;font:inherit;color:var(--ui-text-primary);background:transparent;border:1px solid var(--ui-stroke-secondary);border-radius:7px;padding:3px 6px" placeholder="/Users/you/Projects/My reels"><button class="rootsave">Save</button></div>
          <div class="st tiny mut" style="min-height:14px"></div>
        </div>
        <div class="recbox">
          <button class="allow">🎙 Allow mic</button>
          <button class="rec" style="display:none" disabled><span class="dot"></span><span class="rt">Record</span><span class="t">0:00</span></button>
          <button class="pause" style="display:none">Pause</button>
        </div>
      </div>
      <div class="tabs maintabs"><button class="t-script on" data-t="script">Script</button><button data-t="takes">Takes</button><button data-t="files">Files</button></div>
      <div class="main">
        <div class="card left">
          <div class="tabs lefttabs" style="padding:5px"><button data-t="takes" class="on">Takes</button><button data-t="files">Files</button></div>
          <div class="pane-takes scroll"><div class="crumbs takeshead"></div><div class="takes"></div></div>
          <div class="pane-files scroll" style="display:none"><div class="crumbs fcrumbs"></div><div class="flist"></div></div>
        </div>
        <div class="card view"><div class="head"><span class="t vtitle">Open a script from Files</span><span class="vtools"></span></div><div class="vwrap" style="flex:1;min-height:0;display:flex;flex-direction:column;position:relative"><div class="scroll vbody"></div></div></div>
      </div>`)
    this.el.querySelectorAll('[data-t]').forEach(b => (b.onclick = () => this.tab(b.dataset.t)))
    this.$('.ivol').oninput = () => (this.$('.ivt').textContent = this.$('.ivol').value)
    this.$('.ivol').onchange = () => this.setSound({ input_volume: +this.$('.ivol').value })
    this.$('.ovol').oninput = () => (this.$('.ovt').textContent = this.$('.ovol').value)
    this.$('.ovol').onchange = () => this.setSound({ output_volume: +this.$('.ovol').value })
    this.$('.mute').onclick = () => this.setSound({ muted: !this.state.sound.muted })
    this.$('.sysset').onclick = () => rest('/sound/settings', { method: 'POST', body: {} })
    this.$('.here').onclick = () => { this.state.dest = this.state.cwd; CTX.storage.set('dest', this.state.dest); this.showDest(); this.loadTakes(); this.status('New takes save to ' + (this.state.dest || 'the studio folder')) }
    this.$('.cfg').onclick = () => this.configure()
    this.$('.allow').onclick = () => this.startMic()
    this.$('.dev').onchange = () => { this.mic.running = false; this.startMic(this.$('.dev').value) }
    this.$('.out').onchange = () => { this.sinkId = this.$('.out').value; this.applySink() }
    this.$('.rec').onclick = () => this.toggleRec()
    this.$('.pause').onclick = () => this.togglePause()
    this.zone(-18, -6)
    this.el.addEventListener('keydown', e => this.onKey(e))
    new ResizeObserver(() => this.tpApply()).observe(this.el)
    new MutationObserver(() => this.applySink()).observe(this.el, { childList: true, subtree: true })
  }

  async boot() {
    if (this.booted) return
    this.booted = true
    try {
      const cfg = await rest('/config')
      this.cfg = cfg
      this.state.dest = CTX.storage.get('dest', null) ?? cfg.default_dest
      this.state.cwd = CTX.storage.get('cwd', '') || ''
      this.showDest()
    } catch (e) {
      this.booted = false
      this.$('.main').innerHTML = `<div class="note warn" style="grid-column:1/-1">The Headless Studio backend is not answering (${esc(errText(e))}).
        Turn it on with <code>hermes plugins enable headless-studio</code>, then reopen this panel.</div>`
      return
    }
    this.loadFont()
    this.loadSound()
    this.openDir(this.state.cwd)
    this.loadTakes()
    const script = CTX.storage.get('script', null) || this.cfg.default_script
    if (script) this.openFile({ path: script, name: script.split('/').pop() })
    try { const p = await navigator.permissions.query({ name: 'microphone' }); if (p.state === 'granted') this.startMic() } catch {}
  }

  async loadFont() {
    if (document.fonts && ![...document.fonts].some(f => f.family === 'HSLexend')) {
      try { const f = await rest('/font'); const ff = new FontFace('HSLexend', `url(${f.url})`); await ff.load(); document.fonts.add(ff); this.font = ff } catch {}
    }
  }

  showDest() { this.$('.dest').textContent = this.state.dest || '(studio folder)'; this.$('.dest').title = this.state.dest }

  configure() {
    const row = this.$('.cfgrow'), inp = this.$('.rootin')
    row.style.display = row.style.display === 'none' ? '' : 'none'
    inp.value = this.cfg?.root || ''
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') this.$('.rootsave').click() }
    this.$('.rootsave').onclick = async () => {
      try {
        this.cfg = await rest('/config', { method: 'POST', body: { root: inp.value.trim() } })
        this.state.cwd = ''; this.state.dest = this.cfg.default_dest; CTX.storage.set('cwd', ''); CTX.storage.set('dest', this.state.dest)
        row.style.display = 'none'; this.showDest(); this.openDir(''); this.loadTakes(); this.status('Studio folder: ' + this.cfg.root_resolved)
      } catch (e) { this.status(errText(e), true) }
    }
  }

  tab(t) {
    this.el.dataset.tab = t
    this.el.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t))
    if (t !== 'script') {
      this.$('.pane-takes').style.display = t === 'takes' ? '' : 'none'
      this.$('.pane-files').style.display = t === 'files' ? '' : 'none'
      if (t === 'takes') this.loadTakes()
    }
    setTimeout(() => this.tpApply(), 30)
  }

  /* ---------- files ---------- */
  async openDir(p) {
    let d
    try { d = await rest('/list?path=' + q(p)) } catch (e) { if (p) return this.openDir(''); this.status(errText(e), true); return }
    this.state.cwd = d.path; CTX.storage.set('cwd', d.path)
    const parts = d.path ? d.path.split('/') : []
    this.$('.fcrumbs').innerHTML = `<a data-p="">Studio</a>` + parts.map((s, i) => ` / <a data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(s)}</a>`).join('')
    this.$('.fcrumbs').querySelectorAll('a').forEach(a => (a.onclick = () => this.openDir(a.dataset.p)))
    const list = this.$('.flist'); list.innerHTML = ''
    if (!d.entries.length) list.innerHTML = '<div class="empty">Empty folder</div>'
    const icon = e => e.dir ? 'folder' : /\.(wav|m4a|mp3|aac|aiff?|flac|ogg)$/i.test(e.name) ? 'mic' : /\.(mp4|mov|webm)$/i.test(e.name) ? 'device-camera-video' : /\.(png|jpe?g|gif|webp)$/i.test(e.name) ? 'file-media' : 'file'
    for (const e of d.entries) {
      const el = document.createElement('div')
      el.className = 'ent' + (e.path === this.state.selected ? ' sel' : '')
      el.innerHTML = `<span class="codicon codicon-${icon(e)}"></span><span class="nm" title="${esc(e.name)}">${esc(e.name)}</span><span class="tiny mut">${e.dir ? '' : human(e.size)}</span>`
      el.onclick = () => (e.dir ? this.openDir(e.path) : this.openFile(e))
      list.appendChild(el)
    }
  }

  async openFile(e) {
    this.tpTeardown()
    this.state.selected = e.path
    this.$('.vtitle').textContent = e.name
    const tools = this.$('.vtools'); tools.innerHTML = ''
    const reveal = document.createElement('button'); reveal.textContent = 'Show in Finder'
    reveal.onclick = () => rest('/reveal', { method: 'POST', body: { path: e.path } }); tools.appendChild(reveal)
    const b = this.$('.vbody'); b.innerHTML = ''; b.scrollTop = 0
    const n = e.name.toLowerCase()
    if (window.matchMedia && this.el.clientWidth < 760) this.tab('script')
    try {
      if (/\.(md|txt|markdown)$/.test(n)) {
        const { text } = await rest('/text?path=' + q(e.path))
        CTX.storage.set('script', e.path)
        this.renderReader(text, b)
      } else if (/\.(json|py|csv|srt|vtt|yaml|yml)$/.test(n)) {
        const { text } = await rest('/text?path=' + q(e.path)); const pre = document.createElement('pre'); pre.textContent = text; b.appendChild(pre)
      } else if (/\.(wav|m4a|mp3|aac|aiff?|flac|ogg|mp4|mov|webm|png|jpe?g|gif|webp)$/.test(n)) {
        b.innerHTML = '<div class="empty">Loading…</div>'
        const { url } = await rest('/media?path=' + q(e.path), { timeoutMs: 120000 })
        b.innerHTML = /^data:audio/.test(url) ? `<audio controls src="${url}"></audio>` : /^data:video/.test(url) ? `<video controls src="${url}"></video>` : `<img src="${url}">`
      } else b.innerHTML = '<div class="empty">No preview for this file type.</div>'
    } catch (err) { b.innerHTML = `<div class="note warn" style="margin:10px">${esc(errText(err))}</div>` }
  }

  /* ---------- takes ---------- */
  async loadTakes() {
    let d; const seq = (this.takesSeq = (this.takesSeq || 0) + 1)
    try { d = await rest('/takes?folder=' + q(this.state.dest)); if (seq !== this.takesSeq) return } catch (e) { this.$('.takes').innerHTML = `<div class="note warn" style="margin:8px">${esc(errText(e))}</div>`; return }
    this.$('.takeshead').textContent = `${d.takes.length} take${d.takes.length === 1 ? '' : 's'} · ${(d.folder || 'studio folder').split('/').slice(-3).join(' / ')}`
    const box = this.$('.takes'); box.innerHTML = ''
    if (this.rec.id) box.insertAdjacentHTML('beforeend', `<div class="take live"><div class="r1"><span class="nm" style="color:var(--ui-red)">● Recording…</span><span class="meta livet"></span></div></div>`)
    if (!d.takes.length && !this.rec.id) box.innerHTML = '<div class="empty">No takes yet. Press Record.</div>'
    for (const t of d.takes) box.appendChild(this.takeEl(t))
  }

  takeEl(t) {
    const el = document.createElement('div')
    const open = t.path === this.state.openTake
    el.className = 'take' + (open ? ' open' : '') + (t.path === this.state.justSaved ? ' new' : '')
    const when = new Date(t.mtime * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const m = t.name.match(/take (\d+)/i)
    const label = m ? 'Take ' + +m[1] : t.name.replace(/\.[^.]+$/, '')
    el.innerHTML = `<div class="r1"><span class="star">${t.keep ? '★' : ''}</span><span class="nm">${esc(label)}</span><span class="meta">${when} · ${mmss(t.seconds)}</span></div>
      <div class="np">${esc(t.note)}</div>`
    if (!open) { el.onclick = () => { this.state.openTake = t.path; this.loadTakes() }; return el }
    el.querySelector('.np').remove()
    const base = t.name.replace(/\.[^.]+$/, '')
    el.querySelector('.nm').innerHTML = `<input class="rn" title="Click to rename">`
    const rn = el.querySelector('.rn'); rn.value = base
    rn.onkeydown = e => { if (e.key === 'Enter') rn.blur(); e.stopPropagation() }
    rn.onblur = async () => {
      if (rn.value.trim() === base) return
      try { const j = await rest('/takes/rename', { method: 'POST', body: { path: t.path, name: rn.value } }); this.state.openTake = j.path; this.status('Renamed'); this.loadTakes() }
      catch (e) { this.status(errText(e), true); rn.value = base }
    }
    el.insertAdjacentHTML('beforeend', `<div class="aud"><div class="tiny mut" style="margin-top:6px">Loading player…</div></div>
      <textarea placeholder="Note for this take: best energy on line 6, stumbled on line 11…"></textarea>
      <div class="acts"><button class="kp">${t.keep ? '★ Using this take' : '☆ Use this take'}</button><button class="tr">Move to Bin</button><span class="sp"></span><span class="saved tiny mut"></span></div>`)
    rest('/media?path=' + q(t.path), { timeoutMs: 120000 }).then(({ url }) => { el.querySelector('.aud').innerHTML = `<audio controls src="${url}"></audio>` })
      .catch(e => { el.querySelector('.aud').innerHTML = `<div class="tiny" style="color:var(--ui-red)">${esc(errText(e))}</div>` })
    const ta = el.querySelector('textarea'); ta.value = t.note || ''
    let tm
    const save = async () => { try { await rest('/takes/note', { method: 'POST', body: { path: t.path, note: ta.value } }); el.querySelector('.saved').textContent = 'note saved'; t.note = ta.value } catch (e) { el.querySelector('.saved').textContent = errText(e) } }
    ta.oninput = () => { el.querySelector('.saved').textContent = '…'; clearTimeout(tm); tm = setTimeout(save, 600) }
    ta.onblur = () => { clearTimeout(tm); save() }
    ta.onkeydown = e => e.stopPropagation()
    el.querySelector('.kp').onclick = async () => { await rest('/takes/note', { method: 'POST', body: { path: t.path, keep: !t.keep } }); this.loadTakes() }
    el.querySelector('.tr').onclick = async ev => {
      const b = ev.currentTarget
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'Click again to bin'; b.style.borderColor = 'var(--ui-red)'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Move to Bin'; b.style.borderColor = '' }, 3000); return }
      try { await rest('/takes/trash', { method: 'POST', body: { path: t.path } }); this.status(label + ' moved to the Bin'); this.state.openTake = null; this.loadTakes() } catch (e) { this.status(errText(e), true) }
    }
    return el
  }

  /* ---------- sound ---------- */
  async loadSound() { try { this.state.sound = await rest('/sound'); this.showSound() } catch {} }
  async setSound(body) { try { this.state.sound = await rest('/sound', { method: 'POST', body }); this.showSound() } catch (e) { this.status(errText(e), true) } }
  showSound() {
    const s = this.state.sound
    const mac = s.supported !== false
    for (const c of ['.ivol', '.ovol', '.mute', '.sysset']) this.$(c).disabled = !mac
    if (s.input_volume != null) { this.$('.ivol').value = s.input_volume; this.$('.ivt').textContent = s.input_volume }
    if (s.output_volume != null) { this.$('.ovol').value = s.output_volume; this.$('.ovt').textContent = s.output_volume }
    this.$('.mute').textContent = s.muted ? 'Unmute' : 'Mute'; this.$('.mute').classList.toggle('on', !!s.muted)
    if (!this.$('.dev').options.length) this.$('.dev').innerHTML = `<option>${esc(s.default_in || 'Microphone')} (default)</option>`
    if (!this.$('.out').options.length) this.$('.out').innerHTML = `<option value="">${esc(s.default_out || 'Speakers')} (default)</option>`
  }
  applySink() { if (this.sinkId === undefined) return; this.el.querySelectorAll('audio,video').forEach(a => a.setSinkId && a.sinkId !== this.sinkId && a.setSinkId(this.sinkId).catch(() => {})) }
  zone(lo, hi) { const x = v => ((v + 60) / 60) * 100; const z = this.$('.zone'); z.style.left = x(lo) + '%'; z.style.width = x(hi) - x(lo) + '%' }

  async startMic(deviceId) {
    if (this.mic.running) return
    const allow = this.$('.allow'); allow.textContent = 'Waiting…'
    try {
      this.mic.stream && this.mic.stream.getTracks().forEach(t => t.stop())
      this.mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000 } })
    } catch (e) {
      allow.textContent = '🎙 Allow mic'; this.$('.lvltxt').textContent = 'mic not allowed'
      this.status(`Microphone blocked (${e.name}). macOS: System Settings › Privacy & Security › Microphone › turn on Hermes.`, true)
      return
    }
    const devs = (await navigator.mediaDevices.enumerateDevices())
    const ins = devs.filter(d => d.kind === 'audioinput'), outs = devs.filter(d => d.kind === 'audiooutput')
    const cur = this.mic.stream.getAudioTracks()[0].getSettings().deviceId
    this.$('.dev').innerHTML = ins.map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || 'Microphone')}</option>`).join('')
    if (outs.length) this.$('.out').innerHTML = outs.map(d => `<option value="${d.deviceId === 'default' ? '' : esc(d.deviceId)}">${esc(d.label || 'Speaker')}</option>`).join('')
    if (!deviceId) {
      const want = this.state.sound.default_in, hit = ins.find(d => want && d.label.includes(want))
      if (hit && hit.deviceId !== cur && hit.deviceId !== 'default') return this.startMic(hit.deviceId)
    }
    this.mic.ctx && this.mic.ctx.close()
    const ctx = (this.mic.ctx = new AudioContext({ sampleRate: this.mic.stream.getAudioTracks()[0].getSettings().sampleRate || 48000 }))
    const src = ctx.createMediaStreamSource(this.mic.stream)
    this.mic.analyser = ctx.createAnalyser(); this.mic.analyser.fftSize = 2048; src.connect(this.mic.analyser)
    const code = `class Tap extends AudioWorkletProcessor { process(i){ const c=i[0]&&i[0][0]; if(c) this.port.postMessage(c.slice(0)); return true } } registerProcessor('hs-tap', Tap)`
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url)
    this.mic.node = new AudioWorkletNode(ctx, 'hs-tap'); src.connect(this.mic.node)
    this.mic.node.port.onmessage = ev => { if (this.rec.buf && !this.rec.paused) this.rec.buf.push(ev.data) }
    this.mic.running = true
    allow.style.display = 'none'; const r = this.$('.rec'); r.style.display = ''; r.disabled = false
    this.status(`${this.mic.stream.getAudioTracks()[0].label} · ${ctx.sampleRate} Hz · raw (no auto gain, no noise filter)`)
    this.meter()
  }

  meter() {
    cancelAnimationFrame(this.mic.raf)
    const buf = new Float32Array(this.mic.analyser.fftSize)
    let hold = -90, holdT = 0
    const pct = v => Math.max(0, Math.min(100, ((v + 60) / 60) * 100))
    const loop = () => {
      if (!this.mic.analyser) return
      this.mic.analyser.getFloatTimeDomainData(buf)
      let pk = 0; for (const v of buf) { const a = Math.abs(v); if (a > pk) pk = a }
      const db = 20 * Math.log10(pk + 1e-9), now = performance.now()
      if (db > hold || now - holdT > 1500) { hold = db; holdT = now }
      if (this.el.isConnected) {
        this.$('.lvl').style.width = pct(db) + '%'; this.$('.pk').style.left = pct(hold) + '%'
        this.$('.lvl').style.background = db > -3 ? 'var(--ui-red)' : db > -6 ? 'var(--ui-accent)' : 'var(--ui-green)'
        this.$('.lvltxt').textContent = hold > -3 ? 'too loud' : hold < -30 ? 'quiet' : 'good level'
      }
      this.mic.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  /* ---------- recorder: streams to disk every second ---------- */
  flush() {
    const r = this.rec
    if (!r.buf || !r.buf.length) return r.sending
    const n = r.buf.reduce((a, c) => a + c.length, 0), out = new Float32Array(n)
    let o = 0; for (const c of r.buf) { out.set(c, o); o += c.length }
    r.buf = []
    const bytes = new Uint8Array(out.buffer); let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    const s = r.seq++, id = r.id, data = btoa(bin)
    r.sending = r.sending.then(() => rest('/rec/chunk', { method: 'POST', body: { id, seq: s, data } })).catch(e => this.status('Save problem: ' + errText(e), true))
    return r.sending
  }
  async toggleRec(withScroll) {
    const r = this.rec, b = this.$('.rec')
    if (!r.id) {
      let j
      try { j = await rest('/rec/start', { method: 'POST', body: { folder: this.state.dest, rate: this.mic.ctx.sampleRate } }) } catch (e) { this.status(errText(e), true); return }
      Object.assign(r, { id: j.id, seq: 0, buf: [], t0: performance.now(), paused: false, pausedMs: 0, sending: Promise.resolve() })
      b.classList.add('on'); this.$('.rt').textContent = 'Stop'; this.$('.pause').style.display = ''; this.$('.pause').textContent = 'Pause'
      this.status('Recording to ' + j.file)
      r.timer = setInterval(() => {
        if (r.paused) return
        const s = (performance.now() - r.t0 - r.pausedMs) / 1000
        b.querySelector('.t').textContent = mmss(s); const lt = this.$('.livet'); if (lt) lt.textContent = mmss(s)
        this.tpSyncRec(); this.flush()
      }, 1000)
      if (this.el.clientWidth >= 760) this.tab('takes'); else this.loadTakes()
      this.tpSyncRec()
      r.scroll = withScroll ?? this.state.tp.withRec
      if (r.scroll && this.$('.reader')) this.tpStart(true)
    } else {
      clearInterval(r.timer); this.tpStop()
      await new Promise(res => setTimeout(res, 120)); this.flush(); r.buf = null; await r.sending
      let j
      try { j = await rest('/rec/finish', { method: 'POST', body: { id: r.id } }) } catch (e) { this.status(errText(e), true) }
      r.id = null; b.classList.remove('on'); this.$('.rt').textContent = 'Record'; b.querySelector('.t').textContent = '0:00'
      this.$('.pause').style.display = 'none'; this.tpSyncRec()
      if (j) { this.state.justSaved = j.file; this.state.openTake = j.file; this.status(`Saved ${j.file.split('/').pop()} (${j.seconds.toFixed(1)} s)`) }
      if (this.el.clientWidth >= 760) this.tab('takes'); else this.loadTakes()
    }
  }
  togglePause() {
    const r = this.rec; if (!r.id) return
    r.paused = !r.paused
    this.$('.pause').textContent = r.paused ? 'Resume' : 'Pause'; this.$('.pause').classList.toggle('on', r.paused)
    if (r.paused) { r.pauseT = performance.now(); this.tpStop(); this.status('Paused. Resume carries on in the same take.') }
    else { r.pausedMs += performance.now() - r.pauseT; this.status('Recording'); if (r.scroll && this.$('.reader')) this.tpStart(false) }
  }

  /* ---------- teleprompter ---------- */
  get vb() { return this.$('.vbody') }
  tpSave() { CTX.storage.set('tp', this.state.tp) }
  tpTeardown() { this.tpStop(); this.el.querySelectorAll('.tpbar,.eyeline,.countdown').forEach(x => x.remove()); this.focusMode(false) }

  renderReader(md, host) {
    const tp = this.state.tp
    const r = document.createElement('div'); r.className = 'reader'; host.appendChild(r)
    r.insertAdjacentHTML('beforeend', '<div class="tp-pad top"></div>')
    let blk = null
    const nb = () => { blk = document.createElement('div'); blk.className = 'blk'; r.appendChild(blk) }
    const dark = isDarkBg(host)
    const lines = md.replace(/\r/g, '').split('\n')
    const structured = lines.some(l => /^##\s/.test(l))
    for (const raw of lines) {
      const l = raw.trim()
      if (/^#\s/.test(l)) { const h = document.createElement('h1'); h.textContent = l.slice(2); r.appendChild(h); blk = null; continue }
      if (/^##\s/.test(l)) { const h = document.createElement('h2'); h.textContent = l.slice(3); r.appendChild(h); nb(); continue }
      if (!l) { if (!structured) blk = null; continue }
      if (!blk) nb()
      const d = document.createElement('div')
      if (l.startsWith('> ')) { d.className = 'dir'; d.innerHTML = inlineMd(l.slice(2), dark) }
      else if (/^\(breathe?\)$/i.test(l)) { d.className = 'br'; d.textContent = 'breathe' }
      else { d.className = 'ln'; d.innerHTML = inlineMd(l.replace(/^[-*]\s+/, ''), dark) }
      blk.appendChild(d)
    }
    r.insertAdjacentHTML('beforeend', '<div class="tp-end">End of script</div><div class="tp-pad bottom"></div>')
    this.$('.vwrap').insertAdjacentHTML('beforeend', '<div class="eyeline"><span>▶</span></div>')
    host.insertAdjacentHTML('beforebegin', `
    <div class="tpbar">
      <span class="tpsplit"><button class="tpmain tpPlay" title="Scroll only, no recording (Space)">▶ Scroll</button><button class="tprec" title="Record and scroll together (R). Countdown, then both run; Pause pauses both." aria-label="Record and scroll"><span class="rdot"></span></button></span>
      <button class="tpTop" title="Back to the top (Home)">⤒</button>
      <label class="tpf" title="Reading pace, words per minute (← →)">Speed <input class="tpWpm" type="range" min="70" max="230" step="5"><b class="tpWpmT"></b></label>
      <label class="tpf" title="Pause at the end of each line">Breath <input class="tpBr" type="range" min="0" max="2.5" step="0.1"><b class="tpBrT"></b></label>
      <button class="tpSm" title="Smaller text">A−</button><button class="tpLg" title="Bigger text">A+</button>
      <span class="tpLeft" style="font-variant-numeric:tabular-nums"></span><span class="sp"></span>
      <button class="tpMore" title="Teleprompter settings">⚙</button>
      <button class="tpFocus" title="Prompter only (F, Esc to leave)">⛶</button>
      <div class="tpmore" hidden>
        <label>Line spacing <input class="tpSp" type="range" min="1.1" max="2.2" step="0.05"></label>
        <label>Text width <input class="tpW" type="range" min="45" max="100" step="5"></label>
        <label>Reading line height <input class="tpEye" type="range" min="15" max="60" step="5"></label>
        <label>Countdown <select class="tpCd"><option value="0">none</option><option value="3">3 s</option><option value="5">5 s</option></select></label>
        <label class="ck"><input type="checkbox" class="tpDirs"> Show directions and breaths</label>
        <label class="ck"><input type="checkbox" class="tpWithRec"> Top Record button also scrolls</label>
        <label class="ck"><input type="checkbox" class="tpMirror"> Mirror text (prompter glass)</label>
        <label class="ck"><input type="checkbox" class="tpColors"> Script colours</label>
        <label>Direction colour <span class="sw tpSw"></span></label>
        <button class="tpReset">Reset settings</button>
        <div class="tiny mut">R record + scroll · Space scroll only · ← → speed · ↑ ↓ nudge · Home top · F focus · Esc leave · click a line to jump</div>
      </div>
    </div>`)
    const bind = (cls, key, num = true) => {
      const el = this.$('.' + cls), ck = el.type === 'checkbox'
      ck ? (el.checked = tp[key]) : (el.value = tp[key])
      el.oninput = el.onchange = () => { tp[key] = ck ? el.checked : num ? +el.value : el.value; this.tpSave(); this.tpApply(); this.tpSyncRec() }
    }
    bind('tpWpm', 'wpm'); bind('tpBr', 'breath'); bind('tpSp', 'spacing'); bind('tpW', 'width'); bind('tpEye', 'eye')
    bind('tpCd', 'countdown'); bind('tpDirs', 'dirs'); bind('tpWithRec', 'withRec'); bind('tpMirror', 'mirror'); bind('tpColors', 'colors')
    const sw = this.$('.tpSw')
    sw.innerHTML = Object.entries(COLORS).map(([n, c]) => `<button data-c="${n}" title="${n}" style="background:${c[dark ? 0 : 1]}"></button>`).join('')
    sw.querySelectorAll('button').forEach(b => (b.onclick = () => { tp.dirColor = b.dataset.c; tp.colors = true; this.$('.tpColors').checked = true; this.tpSave(); this.tpApply() }))
    this.$('.tpSm').onclick = () => { tp.size = Math.max(14, tp.size - 3); this.tpSave(); this.tpApply() }
    this.$('.tpLg').onclick = () => { tp.size = Math.min(80, tp.size + 3); this.tpSave(); this.tpApply() }
    this.$('.tpPlay').onclick = () => (this.tpRun || this.tpCount ? this.tpStop() : this.tpStart(true))
    this.$('.tpTop').onclick = () => { this.tpStop(); this.tpPos = 0; this.vb.scrollTop = 0; this.tpHighlight() }
    this.$('.tpMore').onclick = () => { const p = this.$('.tpmore'); p.hidden = !p.hidden; this.$('.tpMore').classList.toggle('on', !p.hidden) }
    this.$('.tpFocus').onclick = () => this.focusMode()
    this.$('.tprec').onclick = () => {
      if (!this.mic.running) return this.startMic()
      this.toggleRec(true)   // the right half always means record AND scroll
    }
    this.$('.tpReset').onclick = () => { this.state.tp = { ...TP_DEF }; this.tpSave(); const s = this.state.selected; this.openFile({ path: s, name: s.split('/').pop() }) }
    this.vb.onscroll = () => { if (!this.tpRun) { this.tpPos = this.vb.scrollTop; this.tpHighlight() } }
    r.querySelectorAll('.blk').forEach(b => (b.onclick = () => this.tpJump(b)))
    this.tpApply(); this.tpSyncRec()
  }

  tpApply() {
    const r = this.$('.reader'); if (!r) return
    const tp = this.state.tp, vb = this.vb, h = vb.clientHeight
    r.style.fontSize = tp.size + 'px'; r.style.setProperty('--ls', tp.spacing); r.style.maxWidth = tp.width + '%'
    r.classList.toggle('mirror', tp.mirror); r.classList.toggle('nodirs', !tp.dirs); r.classList.toggle('mono', !tp.colors)
    const dark = isDarkBg(vb), dc = COLORS[tp.dirColor] || COLORS.orange
    r.style.setProperty('--hs-dir', dc[dark ? 0 : 1]); r.style.setProperty('--hs-br', BREATH[dark ? 0 : 1])
    this.el.querySelectorAll('.tpSw button').forEach(b => b.classList.toggle('on', b.dataset.c === (tp.dirColor || 'orange')))
    this.$('.tpWpmT').textContent = tp.wpm + ' wpm'; this.$('.tpBrT').textContent = tp.breath.toFixed(1) + ' s'
    r.querySelector('.tp-pad.top').style.height = Math.round((h * tp.eye) / 100) + 'px'
    r.querySelector('.tp-pad.bottom').style.height = Math.round(h * (1 - tp.eye / 100)) + 'px'
    const eye = this.$('.eyeline'); if (eye) eye.style.top = vb.offsetTop + (h * tp.eye) / 100 + 'px'
    this.tpBuild(); this.tpHighlight()
  }
  // Each line gets time from its word count at the chosen pace, plus the breath pause.
  tpBuild() {
    const r = this.$('.reader'); if (!r) return
    const tp = this.state.tp, base = r.offsetTop; this.tpSegs = []
    for (const el of r.children) {
      if (el.classList.contains('tp-pad') || el.offsetHeight === 0) continue
      const words = [...el.querySelectorAll('.ln')].map(x => x.textContent.trim().split(/\s+/).length).reduce((a, b) => a + b, 0)
      const secs = el.classList.contains('blk') ? (words ? (words / tp.wpm) * 60 + tp.breath : 0.4) : el.tagName === 'H1' ? 0.6 : 0.3
      this.tpSegs.push({ el, top: el.offsetTop - base, h: el.offsetHeight, secs })
    }
    this.tpLeft()
  }
  tpReadY() { const r = this.$('.reader'); return this.vb.scrollTop + (this.vb.clientHeight * this.state.tp.eye) / 100 - r.offsetTop }
  tpSegAt(y) { let s = this.tpSegs[0]; for (const g of this.tpSegs) if (g.top <= y) s = g; else break; return s }
  tpLeft() {
    const out = this.$('.tpLeft'); if (!out || !this.tpSegs.length) return
    const y = this.tpReadY(); let left = 0
    for (const g of this.tpSegs) { if (g.top + g.h <= y) continue; left += g.secs * (1 - Math.max(0, Math.min(1, (y - g.top) / g.h))) }
    out.textContent = `≈ ${mmss(left)} left`
  }
  tpHighlight() {
    if (!this.tpSegs.length) return
    let s = this.tpSegAt(this.tpReadY())
    if (!s.el.classList.contains('blk')) s = this.tpSegs.find(g => g.top >= s.top && g.el.classList.contains('blk')) || s
    this.el.querySelectorAll('.blk.cur').forEach(x => x !== s.el && x.classList.remove('cur'))
    if (s.el.classList.contains('blk')) s.el.classList.add('cur')
    this.tpLeft()
  }
  tpJump(el) {
    const vb = this.vb
    this.tpPos = vb.scrollTop + el.getBoundingClientRect().top - (vb.getBoundingClientRect().top + (vb.clientHeight * this.state.tp.eye) / 100) + 4
    vb.scrollTo({ top: this.tpPos, behavior: this.tpRun ? 'auto' : 'smooth' }); setTimeout(() => this.tpHighlight(), 350)
  }
  async tpStart(countdown) {
    if (this.tpRun || this.tpCount || !this.$('.reader')) return
    this.tpBuild(); this.tpPos = this.vb.scrollTop; this.tpCount = 1
    const p = this.$('.tpPlay'); p.textContent = '❚❚ Pause'; p.classList.add('on')
    const n0 = countdown ? +this.state.tp.countdown : 0
    if (n0 > 0) {
      const cd = document.createElement('div'); cd.className = 'countdown'; this.$('.vwrap').appendChild(cd)
      for (let n = n0; n > 0; n--) { if (!this.tpCount) { cd.remove(); return } cd.textContent = n; await new Promise(r => setTimeout(r, 1000)) }
      cd.remove(); if (!this.tpCount) return
    }
    this.tpCount = 0; this.tpRun = true; this.tpLast = performance.now()
    const tick = now => {
      if (!this.tpRun) return
      const dt = Math.min(0.1, (now - this.tpLast) / 1000); this.tpLast = now
      const s = this.tpSegAt(this.tpReadY()); if (s && s.secs > 0) this.tpPos += (dt * s.h) / s.secs
      const max = this.vb.scrollHeight - this.vb.clientHeight
      if (this.tpPos >= max) { this.vb.scrollTop = max; this.tpStop(); return }
      this.vb.scrollTop = this.tpPos; this.tpHighlight()
      this.tpRaf = requestAnimationFrame(tick)
    }
    this.tpRaf = requestAnimationFrame(tick)
  }
  tpStop() {
    this.tpRun = false; this.tpCount = 0; cancelAnimationFrame(this.tpRaf)
    this.el.querySelectorAll('.countdown').forEach(x => x.remove())
    const p = this.$('.tpPlay'); if (p) { p.textContent = '▶ Scroll'; p.classList.remove('on') }
  }
  focusMode(on) {
    const f = on ?? !this.el.classList.contains('focus')
    this.el.classList.toggle('focus', f)
    const b = this.$('.tpFocus'); if (b) b.textContent = f ? '✕ Exit' : '⛶'
    setTimeout(() => this.tpApply(), 50)
  }
  tpSyncRec() {
    const b = this.$('.tprec'); if (!b) return
    const on = !!this.rec.id
    b.innerHTML = `<span class="rdot"></span>${on ? this.$('.rec .t').textContent : ''}`; b.classList.toggle('recording', on)
    b.title = on ? 'Stop recording (R)' : 'Record and scroll together (R). Countdown, then both run; Pause pauses both.'
  }
  onKey(ev) {
    if (!this.$('.reader') || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return
    const k = ev.key, tp = this.state.tp
    if (k === ' ') { ev.preventDefault(); this.tpRun || this.tpCount ? this.tpStop() : this.tpStart(true) }
    else if (k === 'ArrowRight' || k === 'ArrowLeft') { tp.wpm = Math.max(70, Math.min(230, tp.wpm + (k === 'ArrowRight' ? 10 : -10))); this.$('.tpWpm').value = tp.wpm; this.tpSave(); this.tpApply(); ev.preventDefault() }
    else if (k === 'ArrowDown' || k === 'ArrowUp') {
      ev.preventDefault()
      if (this.tpRun) { this.tpPos += k === 'ArrowDown' ? 40 : -40; return }
      const blks = this.tpSegs.filter(g => g.el.classList.contains('blk')), cur = this.tpSegAt(this.tpReadY() + 2)
      let i = blks.indexOf(cur); if (i < 0) i = blks.findIndex(g => g.top > cur.top) - (k === 'ArrowDown' ? 1 : 0)
      const nx = blks[Math.max(0, Math.min(blks.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))]; if (nx) this.tpJump(nx.el)
    } else if (k === 'Home') { ev.preventDefault(); this.$('.tpTop').click() }
    else if (k === 'f' || k === 'F') this.focusMode()
    else if ((k === 'r' || k === 'R') && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); this.$('.tprec').click() }
    else if (k === 'Escape') this.focusMode(false)
  }

  dispose() {
    this.tpStop(); cancelAnimationFrame(this.mic.raf)
    if (this.rec.id) { clearInterval(this.rec.timer); this.flush() } // the backend rebuilds an interrupted take on next listing
    this.mic.stream && this.mic.stream.getTracks().forEach(t => t.stop()); this.mic.ctx && this.mic.ctx.close()
    this.mic.analyser = null
    if (this.font) try { document.fonts.delete(this.font) } catch {}
    this.el.remove()
  }
}

/* ---------- React mount: the studio element moves to whichever view mounted last ---------- */
function StudioHost({ where }) {
  const ref = React.useRef(null)
  const [, force] = React.useState(0)
  React.useEffect(() => {
    if (!studio) studio = new Studio()
    const s = studio
    s.owner = where; s.listeners = (s.listeners || new Set()).add(force)
    ref.current.appendChild(s.el); s.boot(); setTimeout(() => s.tpApply(), 50)
    s.listeners.forEach(f => f(x => x + 1))
    return () => { s.listeners.delete(force); s.listeners.forEach(f => f(x => x + 1)) }
  }, [])
  const here = studio && studio.el.parentNode === ref.current
  return jsx('div', {
    style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
    children: [
      jsx('div', { key: 'm', ref, style: { flex: 1, minHeight: 0, display: here || !studio ? 'block' : 'none' } }),
      !here && studio ? jsx('div', { key: 'p', style: { padding: 16, color: 'var(--ui-text-tertiary)', fontSize: 13 },
        children: jsx('button', { onClick: () => { ref.current.appendChild(studio.el); studio.owner = where; studio.tpApply(); studio.listeners.forEach(f => f(x => x + 1)) },
          style: { border: '1px solid var(--ui-stroke-secondary)', borderRadius: 8, padding: '6px 10px', background: 'transparent', color: 'var(--ui-text-secondary)', cursor: 'pointer' },
          children: 'Headless Studio is open in another view. Bring it here' }) }) : null
    ]
  })
}

export default {
  id: ID,
  name: 'Headless Studio',
  register(ctx) {
    CTX = ctx
    const openSide = () => { const r = ctx.runAction?.('view.toggleRightSidebar') }
    ctx.registerMany([
      { id: 'pane', area: PANES_AREA, title: 'Headless Studio', data: { placement: 'right', width: '460px' }, render: () => jsx(StudioHost, { where: 'pane' }) },
      { id: 'page', area: ROUTES_AREA, data: { path: '/headless-studio' }, render: () => jsx(StudioHost, { where: 'page' }) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/headless-studio', label: 'Headless Studio', codicon: 'record' } },
      { id: 'side', area: TITLEBAR_AREAS.right, data: { id: 'headless-studio-side', label: 'Headless Studio (right side)', icon: jsx(Codicon, { name: 'record' }), onSelect: openSide } },
      { id: 'open-page', area: PALETTE_AREA, data: { id: 'headless-studio.open', label: 'Headless Studio: open full page', keywords: ['record', 'teleprompter', 'voiceover', 'studio', 'takes'], run: () => host.navigate('/headless-studio') } },
      { id: 'open-side', area: PALETTE_AREA, data: { id: 'headless-studio.side', label: 'Headless Studio: show in right side', keywords: ['record', 'teleprompter', 'studio'], run: openSide } }
    ])
    ctx.onDispose(() => { if (studio) { studio.dispose(); studio = null } })
  }
}
