import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Eye } from 'lucide-react'
import { loadMyPublicProfiles, PENDING_047, ROLE_LABELS, saveMyPublicProfile, type MyPublicProfile } from '../lib/publicPeople'

// Account Settings card: a coach or referee chooses whether to appear in the
// public directory (consent, unified plan 9.3). Off by default. Only shown to
// people who actually hold one of those roles.
export function PublicPeopleSettings({ client, onNotice }: { client: SupabaseClient; onNotice: (message: string) => void }) {
  const [rows, setRows] = useState<MyPublicProfile[] | null>(null)
  const [state, setState] = useState<'ready' | 'pending' | 'error'>('ready')
  const [drafts, setDrafts] = useState<Record<string, MyPublicProfile>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void loadMyPublicProfiles(client).then(result => {
      if (!active) return
      setRows(result.data); setState(result.state)
      setDrafts(Object.fromEntries(result.data.map(row => [row.role, row])))
    })
    return () => { active = false }
  }, [client])

  const eligible = (rows ?? []).filter(row => row.eligible || row.isPublic)
  // People with neither role see nothing at all.
  if (state === 'ready' && rows !== null && eligible.length === 0) return null
  const save = async (role: MyPublicProfile['role'], isPublic: boolean) => {
    const draft = drafts[role]; if (!draft) return
    setBusy(role); setError('')
    const result = await saveMyPublicProfile(client, { role, isPublic, name: draft.name, island: draft.island, bio: draft.bio })
    setBusy('')
    if (result.error) return setError(result.error)
    setRows(current => (current ?? []).map(row => row.role === role ? { ...draft, isPublic } : row))
    setDrafts(current => ({ ...current, [role]: { ...draft, isPublic } }))
    onNotice(isPublic ? `Your public ${ROLE_LABELS[role].one.toLowerCase()} profile is visible.` : `Your public ${ROLE_LABELS[role].one.toLowerCase()} profile is hidden.`)
  }

  return <section className="pf-card">
    <header className="pf-card-head"><span className="pf-card-icon"><Eye size={18} /></span><div><h3>Public coach and referee profile</h3><p>Off unless you switch it on. Never shows your email or phone.</p></div></header>
    {state === 'pending' ? <p className="pending-note">{PENDING_047}</p>
      : state === 'error' ? <p className="form-error" role="alert">This could not be loaded. Please try again later.</p>
        : rows === null ? <p className="pf-hint">Loading…</p>
          : eligible.map(row => {
            const draft = drafts[row.role] ?? row
            const set = (patch: Partial<MyPublicProfile>) => setDrafts(current => ({ ...current, [row.role]: { ...draft, ...patch } }))
            return <div key={row.role} className="pf-subsection">
              <h4>{ROLE_LABELS[row.role].one}{row.isPublic && row.publicId ? <> · <a className="ed-link" href={`#${row.role}/${row.publicId}`}>View public page</a></> : null}</h4>
              <label className="pf-field">Name to show<input value={draft.name} maxLength={80} onChange={event => set({ name: event.target.value })} /></label>
              <label className="pf-field">Island (optional)<input value={draft.island} maxLength={60} list="kv-islands" onChange={event => set({ island: event.target.value })} /></label>
              <label className="pf-field">Short biography (optional)<textarea rows={3} maxLength={600} value={draft.bio} onChange={event => set({ bio: event.target.value })} placeholder={row.role === 'coach' ? 'Licences, experience, teams coached before' : 'Courses, level, years officiating'} /></label>
              <p className="pf-hint">{row.role === 'coach' ? 'Visitors also see the published teams you coach.' : 'Visitors also see your official matches in published tournaments.'}</p>
              <footer className="pf-card-foot">
                {row.isPublic
                  ? <><button type="button" className="ed-btn ed-btn-primary" disabled={busy === row.role} onClick={() => void save(row.role, true)}>{busy === row.role ? 'Saving…' : 'Save changes'}</button><button type="button" className="ed-btn ed-btn-ghost" disabled={busy === row.role} onClick={() => void save(row.role, false)}>Hide my profile</button></>
                  : <button type="button" className="ed-btn ed-btn-primary" disabled={busy === row.role || !row.eligible} onClick={() => void save(row.role, true)}>{busy === row.role ? 'Saving…' : `Show my ${ROLE_LABELS[row.role].one.toLowerCase()} profile`}</button>}
              </footer>
            </div>
          })}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
