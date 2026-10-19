/**
 * ChatGPT Handover — Desktop half.
 *
 * A full page (/chatgpt) listing ChatGPT conversations synced by the Mac mini collector,
 * a message picker + export preview, and "Continue in Hermes": saves the export as a
 * Markdown file on the backend and PREFILLS a new chat's draft with an @file reference.
 * Anton presses Send — that click is the consent step (design decision 7).
 *
 * Backend: /api/plugins/chatgpt-handover/* (dashboard/plugin_api.py) via ctx.rest.
 * Plain ESM, no build step: jsx()/jsxs() only; imports limited to the SDK + react.
 */
// Namespace import: a named import the running Desktop build lacks would fail the whole
// module at link time. With `sdk.X` + fallbacks an older SDK degrades instead of breaking.
import * as sdk from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const { host, atom, useQuery, useValue } = sdk
const cn = sdk.cn || ((...c) => c.filter(Boolean).join(' '))
const Button = sdk.Button || (p => jsx('button', { type: 'button', onClick: p.onClick, disabled: p.disabled, className: 'rounded border px-2 py-1 text-xs', children: p.children }))
const Badge = sdk.Badge || (p => jsx('span', { className: 'rounded border px-1 text-[0.625rem]', children: p.children }))
const Checkbox = sdk.Checkbox || (p => jsx('input', { type: 'checkbox', className: p.className, checked: !!p.checked, onChange: e => p.onCheckedChange && p.onCheckedChange(e.target.checked) }))
const EmptyState = sdk.EmptyState || (p => jsxs('div', { className: 'text-sm', children: [jsx('div', { children: p.title }), jsx('div', { className: 'text-xs opacity-70', children: p.description })] }))
const SearchField = sdk.SearchField || (p => jsx('input', { className: 'w-full rounded border bg-transparent px-2 py-1 text-xs', placeholder: p.placeholder, value: p.value, onChange: e => p.onChange(e.target.value) }))
const Textarea = sdk.Textarea || (p => jsx('textarea', { ...p, className: 'w-full rounded border bg-transparent p-2 text-xs' }))
const DOT = { good: '#3fb950', warn: '#d29922', bad: '#f85149', muted: '#8b949e' }
const StatusDot = sdk.StatusDot || (p => jsx('span', { style: { display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: DOT[p.tone] || DOT.muted } }))
const relativeTime = sdk.relativeTime || (ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago` })
const queryClient = sdk.queryClient

const ID = 'chatgpt-handover'
const PATH = '/chatgpt'
const QK = [ID, 'conversations']

// Plugin-scoped state shared between the page and the status chip.
const $selected = atom(null)
const $lastVisit = atom(0)
const $originSession = atom(null) // the last chat Anton was in before opening the page
let ctxRef = null

const rest = (path, opts) => ctxRef.rest(path, opts)

// ── helpers ──────────────────────────────────────────────────────────────────

function ago(epochSeconds) {
  return epochSeconds ? relativeTime(epochSeconds * 1000) : 'never'
}

function syncLabel(sync) {
  if (!sync || !sync.at) return { tone: 'warn', text: 'Not synced yet' }
  const state = sync.state || (sync.ok ? 'ok' : 'api_error')
  const when = ago(sync.last_ok_at || sync.at)
  const map = {
    ok: { tone: 'ok', text: `Synced ${when}` },
    paused: { tone: 'ok', text: `Synced ${when} · paused overnight` },
    logging_in: { tone: 'warn', text: 'Logging in to ChatGPT…' },
    logged_out: { tone: 'error', text: `Logged out of ChatGPT · last good sync ${when}` },
    rate_limited: { tone: 'warn', text: `Rate limited · backing off · last good sync ${when}` },
    challenged: { tone: 'error', text: `Blocked by a login challenge · last good sync ${when}` },
    api_error: { tone: 'error', text: `Sync error · last good sync ${when}` }
  }
  return map[state] || map.api_error
}

function useConversations(refetchMs) {
  return useQuery({
    queryKey: QK,
    queryFn: () => rest('/conversations?limit=500'),
    refetchInterval: refetchMs,
    staleTime: 5_000
  })
}

/** Retry a composer write until a mounted surface acknowledges it (fail-closed API). */
async function writeDraft(address, text, tries = 24) {
  for (let i = 0; i < tries; i++) {
    if (await host.composer.setDraft(address, text)) {
      host.composer.focus(address)
      return true
    }
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

// ── page ─────────────────────────────────────────────────────────────────────

function HandoverPage() {
  const { data, error, isLoading, refetch, isFetching } = useConversations(10_000)
  const [query, setQuery] = useState('')
  const selected = useValue($selected)
  const lastVisit = useValue($lastVisit)

  useEffect(() => {
    // Opening the page asks the collector for an immediate sync (throttled to 30 s there).
    rest('/refresh', { method: 'POST' }).catch(() => {})
    const seen = ctxRef.storage.get('lastVisit', 0)
    $lastVisit.set(seen)
    return () => {
      const now = Date.now() / 1000
      ctxRef.storage.set('lastVisit', now)
      $lastVisit.set(now)
    }
  }, [])

  const rows = useMemo(() => {
    const all = (data && data.conversations) || []
    const q = query.trim().toLowerCase()
    return q ? all.filter(r => (r.title + ' ' + (r.snippet || '')).toLowerCase().includes(q)) : all
  }, [data, query])

  const status = syncLabel(data && data.sync)

  return jsxs('div', {
    className: 'grid h-full min-h-0 grid-cols-[minmax(260px,340px)_1fr] gap-0',
    children: [
      jsxs('div', {
        className: 'flex min-h-0 flex-col border-r border-(--ui-stroke-secondary)',
        children: [
          jsxs('div', {
            className: 'flex flex-col gap-2 p-3',
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between gap-2',
                children: [
                  jsx('div', { className: 'text-sm font-medium', children: 'ChatGPT' }),
                  jsx(Button, {
                    size: 'xs',
                    variant: 'ghost',
                    disabled: isFetching,
                    onClick: () => {
                      rest('/refresh', { method: 'POST' }).catch(() => {})
                      setTimeout(() => refetch(), 4000)
                      refetch()
                    },
                    children: isFetching ? 'Refreshing…' : 'Refresh'
                  })
                ]
              }),
              jsxs('div', {
                className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
                children: [
                  jsx(StatusDot, { tone: status.tone === 'ok' ? 'good' : status.tone === 'warn' ? 'warn' : 'bad' }),
                  jsx('span', { children: `${status.text}${data ? ` · ${data.total} conversations` : ''}` })
                ]
              }),
              jsx(SearchField, { placeholder: 'Search titles and previews', value: query, onChange: setQuery })
            ]
          }),
          jsx('div', {
            className: 'min-h-0 flex-1 overflow-y-auto px-1.5 pb-3',
            children: error
              ? jsx('div', { className: 'p-3 text-xs text-(--ui-text-secondary)', children: `Backend unreachable: ${String(error.message || error)}` })
              : isLoading
                ? jsx('div', { className: 'p-3 text-xs text-(--ui-text-tertiary)', children: 'Loading…' })
                : rows.length === 0
                  ? jsx('div', { className: 'p-3 text-xs text-(--ui-text-tertiary)', children: query ? 'No matches.' : 'No conversations synced yet.' })
                  : rows.map(r => jsx(Row, { row: r, active: r.id === selected, isNew: lastVisit && r.first_seen > lastVisit }, r.id))
          })
        ]
      }),
      jsx('div', {
        className: 'min-h-0 overflow-y-auto',
        children: selected
          ? jsx(Detail, { id: selected, row: rows.find(r => r.id === selected) || ((data && data.conversations) || []).find(r => r.id === selected) }, selected)
          : jsx('div', { className: 'p-8', children: jsx(EmptyState, { title: 'Pick a conversation', description: 'Select a ChatGPT conversation to preview its export and continue it here.' }) })
      })
    ]
  })
}

function Row({ row, active, isNew }) {
  // good = content synced · warn = stale or being fetched · muted = list only
  const dot = row.stale || row.requested ? 'warn' : row.has_content ? 'good' : 'muted'
  return jsxs('button', {
    type: 'button',
    onClick: () => $selected.set(row.id),
    className: cn(
      'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
      active ? 'bg-(--ui-accent)/12' : 'hover:bg-(--ui-text-primary)/5'
    ),
    children: [
      jsxs('div', {
        className: 'flex items-center gap-1.5',
        children: [
          jsx(StatusDot, { tone: dot }),
          jsx('span', { className: 'min-w-0 flex-1 truncate text-[0.8125rem]', children: row.title }),
          isNew ? jsx(Badge, { size: 'xs', children: 'new' }) : null,
          jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-quaternary)', children: ago(row.update_time) })
        ]
      }),
      row.snippet
        ? jsx('div', { className: 'line-clamp-1 pl-3.5 text-[0.6875rem] text-(--ui-text-tertiary)', children: row.snippet })
        : null
    ]
  })
}

// ── detail: picker, preview, continue ────────────────────────────────────────

function Detail({ id, row }) {
  const needsFetch = row && (!row.has_content || row.stale)
  useEffect(() => {
    if (needsFetch) rest(`/conversation/${id}/request`, { method: 'POST' }).catch(() => {})
  }, [id, needsFetch])

  const outline = useQuery({
    queryKey: [ID, 'outline', id, row && row.message_count],
    queryFn: () => rest(`/conversation/${id}/outline`),
    retry: false,
    refetchInterval: q => (q.state.status === 'error' ? 3_000 : false)
  })

  const [excluded, setExcluded] = useState(() => new Set())
  const [tools, setTools] = useState(false)
  const [note, setNote] = useState('')
  const [debouncedNote, setDebouncedNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedNote(note), 600)
    return () => clearTimeout(t)
  }, [note])

  const messages = (outline.data && outline.data.messages) || []
  const include = messages.filter(m => !excluded.has(m.index)).map(m => m.index)
  const allIncluded = include.length === messages.length
  const body = { id, include: allIncluded ? null : include, include_tools: tools, note: debouncedNote }

  const preview = useQuery({
    queryKey: [ID, 'preview', id, body.include ? body.include.join(',') : 'all', tools, debouncedNote, row && row.update_time],
    queryFn: () => rest('/handover/preview', { method: 'POST', body }),
    enabled: messages.length > 0,
    retry: false
  })

  const origin = useValue($originSession)

  const save = () => rest('/handover/save', { method: 'POST', body: { ...body, note } })

  const continueNew = async () => {
    setBusy(true)
    try {
      const res = await save()
      host.newChat()
      const ok = await writeDraft('new', res.composer_text)
      if (!ok) {
        await ctxRef.os.writeClipboard(res.composer_text)
        host.notify({ kind: 'warning', message: 'Opened a new chat but could not fill the draft — the reference is on your clipboard.' })
      }
    } catch (e) {
      host.notifyError(e, 'Could not build the handover')
    } finally {
      setBusy(false)
    }
  }

  const continueExisting = async () => {
    if (!origin) return
    setBusy(true)
    try {
      const res = await save()
      await host.openSession(origin)
      const ok = await writeDraft(origin, res.composer_text)
      if (!ok) {
        await ctxRef.os.writeClipboard(res.composer_text)
        host.notify({ kind: 'warning', message: 'Opened the chat but could not fill the draft — the reference is on your clipboard.' })
      }
    } catch (e) {
      host.notifyError(e, 'Could not build the handover')
    } finally {
      setBusy(false)
    }
  }

  const title = (outline.data && outline.data.title) || (row && row.title) || 'Conversation'
  const p = preview.data

  return jsxs('div', {
    className: 'flex flex-col gap-4 p-4',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-start justify-between gap-2',
        children: [
          jsxs('div', {
            className: 'min-w-0',
            children: [
              jsx('div', { className: 'truncate text-base font-medium', children: title }),
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                children: row ? `Updated ${ago(row.update_time)} · ${row.message_count ?? '?'} messages` : ''
              })
            ]
          }),
          jsxs('div', {
            className: 'flex flex-wrap gap-2',
            children: [
              jsx(Button, {
                size: 'sm',
                variant: 'ghost',
                onClick: () => ctxRef.os.openExternal(`https://chatgpt.com/c/${id}`),
                children: 'Open in ChatGPT'
              }),
              origin
                ? jsx(Button, {
                    size: 'sm',
                    variant: 'outline',
                    disabled: busy || !p,
                    onClick: continueExisting,
                    children: 'Add to last chat'
                  })
                : null,
              jsx(Button, {
                size: 'sm',
                disabled: busy || !p,
                onClick: continueNew,
                children: busy ? 'Preparing…' : 'Continue in new chat'
              })
            ]
          })
        ]
      }),
      outline.isError
        ? jsx('div', {
            className: 'rounded-md border border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-secondary)',
            children: 'Fetching this conversation from ChatGPT… it appears here within a few seconds.'
          })
        : null,
      messages.length
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between text-[0.6875rem] text-(--ui-text-tertiary)',
                children: [
                  jsx('span', { children: `${include.length} of ${messages.length} messages included` }),
                  jsxs('div', {
                    className: 'flex items-center gap-3',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'underline-offset-2 hover:underline',
                        onClick: () => setExcluded(allIncluded ? new Set(messages.map(m => m.index)) : new Set()),
                        children: allIncluded ? 'Select none' : 'Select all'
                      }),
                      jsxs('label', {
                        className: 'flex items-center gap-1.5',
                        children: [jsx(Checkbox, { checked: tools, onCheckedChange: v => setTools(v === true) }), 'Include tool output']
                      })
                    ]
                  })
                ]
              }),
              jsx('div', {
                className: 'max-h-64 overflow-y-auto rounded-md border border-(--ui-stroke-secondary)',
                children: messages.map(m =>
                  jsxs('label', {
                    className: 'flex cursor-pointer items-start gap-2 border-b border-(--ui-stroke-secondary)/50 px-2 py-1 last:border-0',
                    children: [
                      jsx(Checkbox, {
                        className: 'mt-0.5',
                        checked: !excluded.has(m.index),
                        onCheckedChange: v => {
                          const next = new Set(excluded)
                          v === true ? next.delete(m.index) : next.add(m.index)
                          setExcluded(next)
                        }
                      }),
                      jsx('span', {
                        className: cn('w-14 shrink-0 text-[0.6875rem]', m.role === 'user' ? 'text-(--ui-accent)' : 'text-(--ui-text-tertiary)'),
                        children: m.role === 'user' ? 'Me' : m.role === 'assistant' ? 'ChatGPT' : m.role
                      }),
                      jsx('span', { className: 'min-w-0 flex-1 truncate text-xs', children: m.preview || '(empty)' }),
                      m.has_code ? jsx(Badge, { size: 'xs', variant: 'outline', children: 'code' }) : null
                    ]
                  }, m.index)
                )
              })
            ]
          })
        : null,
      jsx(Textarea, {
        placeholder: 'Optional note for Hermes (e.g. "focus on the widget; ignore the pricing tangent")',
        value: note,
        onChange: e => setNote(e.target.value),
        rows: 2
      }),
      p
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-tertiary)',
                children: `Export preview · ${p.chars.toLocaleString()} chars · ${p.links} links · ${p.canvas_documents} canvas doc(s)${p.truncated ? ' · TRUNCATED' : ''}`
              }),
              jsx('pre', {
                className: 'max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-(--ui-stroke-secondary) p-3 font-mono text-[0.6875rem] leading-relaxed text-(--ui-text-secondary)',
                children: p.markdown
              })
            ]
          })
        : messages.length
          ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: preview.isError ? 'Preview failed.' : 'Building preview…' })
          : null
    ]
  })
}

// ── status-bar chip ──────────────────────────────────────────────────────────

function Chip() {
  const { data } = useConversations(60_000)
  const lastVisit = useValue($lastVisit)
  if (!data) return null
  const broken = data.sync && data.sync.state && !['ok', 'paused', 'logging_in'].includes(data.sync.state)
  const fresh = lastVisit ? data.conversations.filter(r => r.first_seen > lastVisit).length : 0
  return jsxs('button', {
    type: 'button',
    title: syncLabel(data.sync).text,
    onClick: () => host.navigate(PATH),
    className: 'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
    children: [
      broken ? jsx(StatusDot, { tone: 'bad' }) : null,
      jsx('span', { children: fresh ? `ChatGPT · ${fresh} new` : 'ChatGPT' })
    ]
  })
}

// ── registration ─────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'ChatGPT Handover',
  register(ctx) {
    ctxRef = ctx
    $lastVisit.set(ctx.storage.get('lastVisit', 0))

    // Remember the last chat Anton was in, so "Add to last chat" can target it.
    const focused = host.state && host.state.focusedStoredSessionId
    if (focused) {
      const track = () => {
        const sid = focused.get()
        if (sid) $originSession.set(sid)
      }
      track()
      ctx.onDispose(focused.subscribe(track))
    }

    const contributions = [
      { id: 'page', area: sdk.ROUTES_AREA || 'routes', data: { path: PATH }, render: () => jsx(HandoverPage, {}) },
      { id: 'nav', area: sdk.SIDEBAR_NAV_AREA || 'sidebar.nav', data: { path: PATH, label: 'ChatGPT', codicon: 'comment-discussion' } },
      {
        id: 'open',
        area: sdk.PALETTE_AREA || 'palette',
        data: { id: `${ID}.open`, label: 'ChatGPT: browse and hand over a conversation', keywords: ['chatgpt', 'handover', 'import', 'openai'], run: () => host.navigate(PATH) }
      },
      sdk.STATUSBAR_AREAS ? { id: 'chip', area: sdk.STATUSBAR_AREAS.right, order: 140, render: () => jsx(Chip, {}) } : null
    ].filter(Boolean)
    if (ctx.registerMany) ctx.registerMany(contributions)
    else contributions.forEach(c => ctx.register(c))

    if (queryClient) ctx.onDispose(() => queryClient.removeQueries({ queryKey: [ID] }))
  }
}
