import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { ArrowRight, GitBranch, Plus, X } from 'lucide-react'
import { createCompetitionPlan, generateFixtures, manualFixtures } from '../lib/competition'
import type { CompetitionFormat } from '../lib/competition'

export type DrawTeam = { id: string; name: string }
export type DrawCategory = { id: string; name: string }

// Draw and fixtures from real approved entries. Teams are picked by name, the
// category is an existing row (or a new one), and the preview shows exactly the
// fixtures that will be saved. Nothing is published by saving a draw.
export function CompetitionPlanner({ client, user, tournamentId, teams, categories, onNotice, onSaved }: {
  client: SupabaseClient; user: User; tournamentId: string; teams: DrawTeam[]; categories: DrawCategory[]; onNotice: (message: string) => void; onSaved?: () => void
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [newCategory, setNewCategory] = useState('Open category')
  const [stage, setStage] = useState('Main stage')
  const [selectedTeams, setSelectedTeams] = useState<string[]>(() => teams.map(team => team.id))
  const [format, setFormat] = useState<CompetitionFormat>('round_robin')
  const [drawMode, setDrawMode] = useState<'automatic' | 'manual'>('automatic')
  const [groupCount, setGroupCount] = useState(2)
  const [qualifiers, setQualifiers] = useState(2)
  const [pairs, setPairs] = useState<Array<[string, string]>>([['', '']])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const name = (id: string) => teams.find(team => team.id === id)?.name ?? 'Team'
  const validPairs = pairs.filter(pair => pair[0] && pair[1])
  const preview = drawMode === 'manual' ? manualFixtures(validPairs) : generateFixtures(format, selectedTeams, groupCount).fixtures
  const usesGroups = format === 'group_stage' || format === 'groups_knockout'
  const toggleTeam = (id: string) => setSelectedTeams(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!categoryId && !newCategory.trim()) return setError('Choose a category or name a new one.')
    if (!stage.trim()) return setError('Name the stage.')
    if (preview.length === 0) return setError('Select at least two teams to create fixtures.')
    setSaving(true)
    const result = await createCompetitionPlan(client, user.id, tournamentId, newCategory, stage, format, selectedTeams, groupCount, drawMode, validPairs, { categoryId: categoryId || null, qualifiersPerGroup: qualifiers })
    setSaving(false)
    if (result.error) return setError(result.error.includes('duplicate') ? 'A stage with this name already exists in this category. Choose another stage name.' : result.error)
    onNotice(`${result.fixtureCount} fixture${result.fixtureCount === 1 ? '' : 's'} saved. Set dates and venues next; nothing is published yet.`)
    onSaved?.()
  }

  if (teams.length < 2) return <div className="state-block"><GitBranch size={22} /><h3>Not enough approved teams</h3><p>A draw needs at least two approved entries. Approve applications or add teams directly in Teams &amp; rosters first.</p></div>

  return <div className="competition-planner">
    <div className="creator-header"><div><h4><GitBranch size={15} /> Competition format and draw</h4><p>Preview before saving. Each saved draw keeps an auditable fixture version.</p></div><span className="private-label">Draft only</span></div>
    <form className="planner-form" onSubmit={submit}>
      <label>Category<select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
        {categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}
        <option value="">New category…</option>
      </select></label>
      {!categoryId && <label>New category name<input value={newCategory} onChange={event => setNewCategory(event.target.value)} /></label>}
      <label>Stage name<input value={stage} onChange={event => setStage(event.target.value)} /></label>
      <label>Draw<select value={drawMode} onChange={event => setDrawMode(event.target.value as 'automatic' | 'manual')}><option value="automatic">Automatic</option><option value="manual">Manual pairings</option></select></label>
      {drawMode === 'automatic' && <>
        <label>Format<select value={format} onChange={event => setFormat(event.target.value as CompetitionFormat)}>
          <option value="round_robin">Round robin</option><option value="two_leg">Round robin, home and away</option><option value="group_stage">Group stage</option><option value="knockout">Knockout</option><option value="groups_knockout">Groups then knockout</option><option value="round_robin_then_final">Round robin then final (1st to final, 2nd vs 3rd semi)</option>
        </select></label>
        {usesGroups && <label>Groups<input type="number" min="1" max="16" value={groupCount} onChange={event => setGroupCount(Math.max(1, Number(event.target.value)))} /></label>}
        {format === 'groups_knockout' && <label>Qualifiers per group<input type="number" min="1" max="4" value={qualifiers} onChange={event => setQualifiers(Math.max(1, Number(event.target.value)))} /></label>}
        <fieldset className="team-picker"><legend>Teams in this draw ({selectedTeams.length} of {teams.length})</legend>
          {teams.map(team => <label key={team.id}><input type="checkbox" checked={selectedTeams.includes(team.id)} onChange={() => toggleTeam(team.id)} /> {team.name}</label>)}
        </fieldset>
      </>}
      {drawMode === 'manual' && <fieldset className="team-picker"><legend>Pairings</legend>
        {pairs.map((pair, index) => <div className="button-row" key={index}>
          <select aria-label={`Home team ${index + 1}`} value={pair[0]} onChange={event => setPairs(current => current.map((item, i) => i === index ? [event.target.value, item[1]] : item))}><option value="">Home…</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select>
          <span>vs</span>
          <select aria-label={`Away team ${index + 1}`} value={pair[1]} onChange={event => setPairs(current => current.map((item, i) => i === index ? [item[0], event.target.value] : item))}><option value="">Away…</option>{teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select>
          {pairs.length > 1 && <button type="button" className="ghost-button" aria-label="Remove pairing" onClick={() => setPairs(current => current.filter((_, i) => i !== index))}><X size={14} /></button>}
        </div>)}
        <button type="button" className="ghost-button" onClick={() => setPairs(current => [...current, ['', '']])}><Plus size={14} /> Add pairing</button>
        <small>A team appears in at most one manual pairing; repeated or identical teams are skipped.</small>
      </fieldset>}
      <div className="fixture-preview"><strong>Preview: {preview.length} fixture{preview.length === 1 ? '' : 's'}</strong>
        <ul className="plain-list">{preview.slice(0, 40).map((fixture, index) => <li key={index}>{fixture.group ? `${fixture.group} · ` : ''}{fixture.round ? `Round ${fixture.round} · ` : ''}{name(fixture.homeTeamId)} vs {name(fixture.awayTeamId)}{fixture.leg === 2 ? ' (2nd leg)' : ''}</li>)}</ul>
        {preview.length > 40 && <small>…and {preview.length - 40} more.</small>}
        {format === 'knockout' && drawMode === 'automatic' && selectedTeams.length > 2 && (selectedTeams.length & (selectedTeams.length - 1)) !== 0 && <small>{selectedTeams.length - preview.length * 2} team(s) receive a bye into the next round.</small>}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save draw'} <ArrowRight size={15} /></button>
    </form>
  </div>
}
