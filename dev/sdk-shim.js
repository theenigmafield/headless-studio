// Minimal stand-in for @hermes/plugin-sdk, for the dev harness only.
import * as React from 'react'
import { jsx } from 'react/jsx-runtime'

export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const PALETTE_AREA = 'palette'
export const TITLEBAR_AREAS = { left: 'titlebar.left', center: 'titlebar.center', right: 'titlebar.right' }
export const Codicon = ({ name }) => jsx('span', { className: `codicon codicon-${name}` })
export const host = { navigate: p => console.log('navigate', p), notify: m => console.log('notify', m) }

export function makeCtx(id) {
  const contributions = []
  const disposers = []
  const store = {}
  return {
    contributions,
    disposers,
    rest: async (path, opts = {}) => {
      const r = await fetch(`/api/plugins/${id}${path}`, {
        method: opts.method || 'GET',
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      })
      const text = await r.text()
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`)
      return JSON.parse(text)
    },
    storage: {
      get: (k, d) => (k in store ? store[k] : d),
      set: (k, v) => { store[k] = v },
      remove: k => { delete store[k] }
    },
    register: c => { contributions.push(c); return () => {} },
    registerMany: cs => { contributions.push(...cs); return () => {} },
    onDispose: fn => disposers.push(fn),
    runAction: id => { console.log('runAction', id); return { ok: true } },
    // native folder picker stand-in: tests set window.__pickPath (null = cancelled)
    os: { pickOpenPath: async opts => { window.__pickOpts = opts; return window.__pickPath ?? null } }
  }
}
