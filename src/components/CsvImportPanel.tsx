import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { applyColumnMapping, autoMapColumns, buildImportRows, commitImport, defaultSelection, findExistingRecords, IMPORT_COLUMNS, importTemplate, markExistingDuplicates, parseCsv, toCsv, type ColumnMapping, type ImportKind, type ImportOutcome, type ImportRow } from '../lib/csvImport'
import { readXlsxTable } from '../lib/xlsx'

// Reviewed import: load -> preview with problems and likely duplicates ->
// choose rows -> confirm. Nothing is written before the confirm click.
// CSV or .xlsx (first sheet); the file's columns are matched to the expected
// ones, and any the organizer has to choose are shown before the preview.
export function CsvImportPanel({ client, user, organizationId, kind, onNotice, onImported, defaultOpen = false }: { client: SupabaseClient; user: User; organizationId: string; kind: ImportKind; onNotice: (message: string) => void; onImported?: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [text, setText] = useState('')
  const [sourceName, setSourceName] = useState('pasted CSV')
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [problems, setProblems] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const columns = IMPORT_COLUMNS[kind]
  const noun = kind === 'team' ? 'team' : 'player'

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    if (file.size > 1024 * 1024) return setProblems(['The file is larger than 1 MB.'])
    if (/.xls$/i.test(file.name)) return setProblems(['Old .xls workbooks cannot be read. Save the sheet as .xlsx or CSV and try again.'])
    setProblems([]); setRows(null); setOutcome(null); setMapping(null)
    if (/.xlsx$/i.test(file.name)) {
      const workbook = await readXlsxTable(await file.arrayBuffer())
      if (workbook.error) return setProblems([workbook.error])
      setText(toCsv(workbook.table)); setSourceName(file.name); return
    }
    setText(await file.text()); setSourceName(file.name)
  }

  const preview = async () => {
    setChecking(true); setOutcome(null)
    const table = parseCsv(text)
    const columns = mapping ?? autoMapColumns(kind, table[0] ?? [])
    setMapping(columns)
    const built = buildImportRows(kind, applyColumnMapping(kind, table, columns))
    setProblems(built.headerProblems)
    if (built.headerProblems.length) { setChecking(false); setRows(null); return }
    const existing = await findExistingRecords(client, kind, built.rows.map(row => row.name))
    setChecking(false)
    if (existing.error) setProblems([`Existing records could not be checked for duplicates: ${existing.error}. Fix this before importing.`])
    const marked = existing.error ? built.rows : markExistingDuplicates(built.rows, existing.data)
    setRows(marked)
    setSelected(existing.error ? new Set() : defaultSelection(marked))
  }

  const toggle = (line: number) => setSelected(current => { const next = new Set(current); if (next.has(line)) next.delete(line); else next.add(line); return next })

  const commit = async () => {
    if (!rows) return
    setConfirming(false); setProgress(0)
    const chosen = rows.filter(row => selected.has(row.line) && row.problems.length === 0)
    const result = await commitImport(client, { kind, rows: chosen, userId: user.id, organizationId, sourceName, onProgress: setProgress })
    setProgress(null); setOutcome(result); setRows(null); setText(''); setMapping(null)
    onNotice(`${result.created} ${noun} record${result.created === 1 ? '' : 's'} created from ${sourceName}.${result.failed.length ? ` ${result.failed.length} row(s) need attention.` : ''}`)
    onImported?.()
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([importTemplate(kind)], { type: 'text/csv' }))
    const link = document.createElement('a'); link.href = url; link.download = `kulhivaru-${noun}-import-template.csv`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const header = text.trim() ? parseCsv(text)[0] ?? [] : []

  if (!open) return <button type="button" className="outline-button dark" onClick={() => setOpen(true)}><FileSpreadsheet size={14} /> Import {noun}s from CSV or Excel</button>
  const chosenCount = rows ? rows.filter(row => selected.has(row.line) && row.problems.length === 0).length : 0
  return <section className="panel-block csv-import">
    <h3><FileSpreadsheet size={16} /> Import {noun}s from CSV or Excel</h3>
    <p className="field-hint">First row: column names. Required: <code>{columns.required.join(', ')}</code>; optional: <code>{columns.optional.join(', ')}</code>. Existing records are never changed; likely duplicates are left out unless you tick them.{kind === 'team' ? ' Imported teams are linked to this organization and you become their manager until a real manager claims them.' : ' Imported players are unclaimed records; invite each person to claim theirs.'}</p>
    <div className="button-row"><input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => void loadFile(event)} aria-label="Choose CSV or Excel file" /><button type="button" className="ghost-button" onClick={downloadTemplate}><Download size={14} /> Download template</button></div>
    <label>Or paste CSV<textarea rows={5} value={text} onChange={event => { setText(event.target.value); setSourceName('pasted CSV'); setRows(null); setMapping(null) }} placeholder={kind === 'team' ? 'name,island,team_type\nKulhudhuffushi Youth,HDh. Kulhudhuffushi,club' : 'name,island\nAhmed Ali,Malé'} /></label>
    {mapping && header.length > 0 && <fieldset className="import-mapping"><legend>Match your columns</legend>{[...columns.required, ...columns.optional].map(column => <label key={column}>{column}{columns.required.includes(column) ? ' (required)' : ''}<select value={mapping[column] ?? -1} onChange={event => { setMapping({ ...mapping, [column]: Number(event.target.value) }); setRows(null) }}><option value={-1}>Not in this file</option>{header.map((cell, index) => <option key={`${index}-${cell}`} value={index}>{cell.trim() || `Column ${index + 1}`}</option>)}</select></label>)}</fieldset>}
    <div className="button-row"><button type="button" className="outline-button dark" disabled={!text.trim() || checking} onClick={() => void preview()}>{checking ? <Loader2 className="spin" size={14} /> : null} Preview</button>{!defaultOpen && <button type="button" className="ghost-button" onClick={() => { setOpen(false); setRows(null); setText(''); setMapping(null) }}>Close</button>}</div>
    {problems.map(problem => <div className="form-error" role="alert" key={problem}>{problem}</div>)}
    {rows && <>
      <div className="table-scroll"><table className="import-table"><thead><tr><th>Import</th><th>Line</th><th>Name</th><th>Island</th>{kind === 'team' && <th>Type</th>}<th>Check</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.line} className={row.problems.length ? 'row-error' : row.duplicateOf || row.duplicateInFile ? 'row-warn' : ''}>
          <td><input type="checkbox" aria-label={`Import line ${row.line}`} disabled={row.problems.length > 0} checked={selected.has(row.line) && row.problems.length === 0} onChange={() => toggle(row.line)} /></td>
          <td>{row.line}</td><td>{row.name || '—'}</td><td>{row.island || '—'}</td>{kind === 'team' && <td>{row.teamType}</td>}
          <td>{row.problems.length ? row.problems.join(' ') : row.duplicateOf ? `Likely duplicate of ${row.duplicateOf}` : row.duplicateInFile ? 'Repeated in this file' : 'New'}</td>
        </tr>)}</tbody></table></div>
      {confirming ? <span className="confirm-group"><span>Create {chosenCount} {noun} record{chosenCount === 1 ? '' : 's'}?</span><button type="button" className="primary-button" onClick={() => void commit()}>Yes, import</button><button type="button" className="outline-button dark" onClick={() => setConfirming(false)}>Cancel</button></span>
        : <button type="button" className="primary-button" disabled={chosenCount === 0} onClick={() => setConfirming(true)}>Import {chosenCount} selected</button>}
    </>}
    {progress !== null && <div className="loading-state"><Loader2 className="spin" size={14} /> Importing… {progress} done</div>}
    {outcome && outcome.failed.length > 0 && <div className="form-error" role="alert">Rows that need attention:<ul className="plain-list">{outcome.failed.map(item => <li key={`${item.line}-${item.error}`}>Line {item.line}: {item.error}</li>)}</ul></div>}
  </section>
}
