// End-to-end check of the plugin in headless Chrome with a fake microphone.
//   node dev/e2e.mjs <cdpPort> <harnessUrl> <shotDir> <rootDir>
import { writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
const [port, url, dir, root] = process.argv.slice(2)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => (ws.onopen = r))
let id = 0; const pend = {}; let pass = 0, fail = 0
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id] }
  if (d.method === 'Runtime.exceptionThrown') { console.log('PAGE EXCEPTION:', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); fail++ }
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.log('console.error:', d.params.args.map(a => a.value ?? a.description).join(' ')) }
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return 'ERR ' + r.result.exceptionDetails.exception?.description; return r.result?.result?.value }
const shot = async n => { const s = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${dir}/${n}.png`, Buffer.from(s.result.data, 'base64')) }
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  | ' + info : ''}`) }
const S = `document.querySelector('.hs')`
const $ = sel => `${S}.querySelector(${JSON.stringify(sel)})`

await cdp('Runtime.enable')
await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 780, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: url + '?mode=page' }); await sleep(4000)
check('plugin mounted', await ev(`!!${S}`))
check('contributions', (await ev(`__hs.ctx.contributions.map(c=>c.area).join(',')`)) === 'panes,routes,sidebar.nav,titlebar.right,palette,palette', await ev(`__hs.ctx.contributions.map(c=>c.area).join(',')`))
check('files listed', (await ev(`${S}.querySelectorAll('.flist .ent').length`)) >= 1, await ev(`[...${S}.querySelectorAll('.flist .nm')].map(x=>x.textContent).join(', ')`))
// open the script
await ev(`(async()=>{ ${S}.querySelector('[data-t=files]').click(); await new Promise(r=>setTimeout(r,200)); [...${S}.querySelectorAll('.flist .ent')].find(e=>e.textContent.includes('script')).click(); await new Promise(r=>setTimeout(r,600)); [...${S}.querySelectorAll('.flist .ent')].find(e=>e.textContent.includes('Reading script')).click(); return true })()`)
await sleep(1500)
check('reader rendered', (await ev(`${S}.querySelectorAll('.reader .blk').length`)) >= 3, (await ev(`${S}.querySelectorAll('.reader .blk').length`)) + ' blocks')
check('lexend loaded', await ev(`[...document.fonts].some(f=>f.family==='HSLexend' && f.status==='loaded')`))
check('split button: scroll | record', (await ev(`[...${S}.querySelectorAll('.tpsplit button')].map(b=>b.className).join(' ')`)) === 'tpmain tpPlay tprec')
check('teleprompter bar', (await ev(`${$('.tpWpmT')}.textContent`)) === '140 wpm')
check('directions coloured (orange)', (await ev(`getComputedStyle(${S}.querySelector('.reader .dir')).color`)) === 'rgb(240, 160, 75)', await ev(`getComputedStyle(${S}.querySelector('.reader .dir')).color`))
check('inline markdown', (await ev(`${S}.querySelector('.reader b')?.textContent`)) === 'one' && (await ev(`!!${S}.querySelector('.reader mark') && !!${S}.querySelector('.reader .c')`)))
await ev(`(${$('.tpColors')}.checked=false, ${$('.tpColors')}.dispatchEvent(new Event('change')), true)`)
check('colours can be turned off', (await ev(`getComputedStyle(${S}.querySelector('.reader .dir')).color`)) !== 'rgb(240, 160, 75)')
await ev(`${S}.querySelector('.tpSw [data-c=teal]').click(), true`)
check('colour swatch: teal', (await ev(`getComputedStyle(${S}.querySelector('.reader .dir')).color`)) === 'rgb(79, 209, 197)')
await ev(`${S}.querySelector('.tpSw [data-c=orange]').click(), true`)
check('mic button or already granted', await ev(`getComputedStyle(${$('.allow')}).display !== 'none' || ${$('.rec')}.style.display === ''`))
await shot('1-page-idle')
// allow mic
await ev(`${$('.allow')}.click(), true`); await sleep(2500)
check('mic running', await ev(`${$('.rec')}.style.display === '' && !${$('.rec')}.disabled`), await ev(`${$('.st')}.textContent`))
check('meter reading', (await ev(`${$('.lvltxt')}.textContent`)) !== 'mic off', await ev(`${$('.lvltxt')}.textContent`))
// teleprompter scroll alone
await ev(`(${$('.tpCd')}.value='0', ${$('.tpCd')}.dispatchEvent(new Event('change')), ${$('.tpPlay')}.click(), true)`)
const y0 = await ev(`${$('.vbody')}.scrollTop`); await sleep(2500); const y1 = await ev(`${$('.vbody')}.scrollTop`)
check('auto-scroll moves', y1 - y0 > 20, `${Math.round(y1 - y0)} px in 2.5 s`)
await ev(`${S}.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})), true`)
check('space pauses', (await ev(`${$('.tpPlay')}.textContent`)).includes('Scroll'))
await ev(`${S}.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})), true`)
check('arrow speeds up', (await ev(`${$('.tpWpmT')}.textContent`)) === '150 wpm')
check('settings persisted', (await ev(`__hs.ctx.storage.get('tp').wpm`)) === 150)
// record with countdown
await ev(`(${$('.tpCd')}.value='3', ${$('.tpCd')}.dispatchEvent(new Event('change')), ${$('.tpTop')}.click(), true)`)
await ev(`${$('.tprec')}.click(), true`); await sleep(1200)
check('record half shows time while recording', await ev(`${$('.tprec')}.classList.contains('recording')`))
check('countdown shows', (await ev(`${$('.countdown')}?.textContent`)) != null)
check('recording file streaming', readdirSync(root + '/takes').some(f => f.endsWith('.wav.recording')), readdirSync(root + '/takes').join(', '))
await shot('2-countdown')
await sleep(3500)
check('scroll follows record', await ev(`!!${$('.tpPlay')}.textContent.includes('Pause')`))
await ev(`${$('.pause')}.click(), true`); await sleep(400)
check('pause stops scroll', (await ev(`${$('.tpPlay')}.textContent`)).includes('Scroll'))
await sleep(1500)
await ev(`${$('.pause')}.click(), true`); await sleep(1500)
check('resume restarts scroll', (await ev(`${$('.tpPlay')}.textContent`)).includes('Pause'))
await ev(`${S}.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true})), true`); await sleep(500)
check('focus mode', await ev(`${S}.classList.contains('focus')`))
await shot('3-focus-recording')
await ev(`${S}.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})), true`)
await ev(`${$('.tprec')}.click(), true`); await sleep(2500)
const st = await ev(`${$('.st')}.textContent`)
check('take saved', /Saved .*take 01\.wav/.test(st), st)
const wav = readdirSync(root + '/takes').find(f => /take 01\.wav$/.test(f))
const buf = wav && readFileSync(root + '/takes/' + wav)
const secs = buf ? (buf.length - 58) / 4 / buf.readUInt32LE(24) : 0
check('wav valid float32', buf && buf.toString('ascii', 0, 4) === 'RIFF' && buf.readUInt16LE(20) === 3, `${secs.toFixed(1)} s audio (expected about 6.5 s, pause excluded)`)
check('no leftover .recording', !readdirSync(root + '/takes').some(f => f.endsWith('.recording')))
// takes list
await sleep(800)
check('take listed + open', (await ev(`${S}.querySelectorAll('.takes .take').length`)) === 1 && await ev(`!!${S}.querySelector('.takes .take.open')`))
for (let i = 0; i < 20 && !(await ev(`!!${S}.querySelector('.takes audio')`)); i++) await sleep(500)
check('player loads (AAC preview)', (await ev(`${S}.querySelector('.takes audio')?.src.startsWith('data:audio/mp4;base64')`)) === true, await ev(`${S}.querySelector('.takes .aud')?.textContent || 'no .aud; open=' + !!${S}.querySelector('.takes .take.open')`))
await ev(`(()=>{const t=${S}.querySelector('.takes textarea'); t.value='Best energy on line 3'; t.dispatchEvent(new Event('input')); return true})()`); await sleep(1200)
const notes = JSON.parse(readFileSync(root + '/takes/takes-notes.json', 'utf8'))
check('note saved to disk', Object.values(notes)[0]?.note === 'Best energy on line 3')
await ev(`${S}.querySelector('.takes .kp').click(), true`); await sleep(800)
check('star saved', Object.values(JSON.parse(readFileSync(root + '/takes/takes-notes.json', 'utf8')))[0]?.keep === true)
await shot('4-takes')
await ev(`(()=>{const i=${S}.querySelector('.takes .rn'); i.value='Keeper take'; i.dispatchEvent(new Event('blur')); return true})()`); await sleep(900)
check('rename + note follows', existsSync(root + '/takes/Keeper take.wav') && JSON.parse(readFileSync(root + '/takes/takes-notes.json', 'utf8'))['Keeper take.wav']?.note === 'Best energy on line 3')
// path traversal
check('blocks ../ escape', (await ev(`__hs.ctx.rest('/text?path=../../etc/passwd').then(()=>'leak').catch(e=>String(e.message).slice(0,8))`)) === 'HTTP 403')
// narrow pane layout
await cdp('Emulation.setDeviceMetricsOverride', { width: 460, height: 780, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: url + '?mode=pane' }); await sleep(4000)
check('pane mounted (narrow)', await ev(`!!${S} && getComputedStyle(${$('.maintabs')}).display !== 'none'`))
await shot('5-pane-narrow')
await ev(`${S}.querySelector('.maintabs [data-t=takes]').click(), true`); await sleep(1500)
await shot('6-pane-takes')
console.log(`\n${pass} passed, ${fail} failed`)
ws.close(); process.exit(fail ? 1 : 0)
