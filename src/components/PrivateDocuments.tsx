import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FileLock2 } from 'lucide-react'
import { formatFileSize, loadEntryDocuments, privateDocumentLink, type PrivateDocument } from '../lib/documents'

// A list of private documents with an "Open" action that requests a
// 60-second signed link at the moment of the click. The link is opened in a
// new tab and never stored.
export function PrivateDocumentList({ client, documents }: { client: SupabaseClient; documents: PrivateDocument[] }) {
  const [error, setError] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const open = async (document: PrivateDocument) => {
    setOpening(document.id); setError('')
    const result = await privateDocumentLink(client, document.storagePath)
    setOpening(null)
    if (result.error || !result.url) return setError(result.error ?? 'The document could not be opened.')
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }
  if (documents.length === 0) return <small>No private documents are attached.</small>
  return <>
    <ul className="plain-list document-list">{documents.map(document => <li key={document.id}>
      <FileLock2 size={13} /> <strong>{document.originalName}</strong> · {document.documentType.replace(/_/g, ' ')} · {formatFileSize(document.sizeBytes)}
      <button type="button" className="ghost-button" disabled={opening === document.id} onClick={() => void open(document)}>{opening === document.id ? 'Opening…' : 'Open'}</button>
    </li>)}</ul>
    {error && <div className="form-error" role="alert">{error}</div>}
    <small>Links expire after one minute. Only this team and the tournament organizer can open these files.</small>
  </>
}

// Documents for one tournament entry, loaded on demand for organizer review.
export function EntryDocuments({ client, entryId }: { client: SupabaseClient; entryId: string }) {
  const [open, setOpen] = useState(false)
  const [documents, setDocuments] = useState<PrivateDocument[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || documents) return
    let active = true
    void loadEntryDocuments(client, entryId).then(result => { if (!active) return; setDocuments(result.data); setError(result.error ?? '') })
    return () => { active = false }
  }, [client, entryId, open, documents])
  return <div className="entry-documents">
    <button type="button" className="ghost-button" onClick={() => setOpen(value => !value)}><FileLock2 size={13} /> {open ? 'Hide documents' : 'Documents'}</button>
    {open && (error ? <div className="form-error" role="alert">{error}</div> : documents === null ? <small>Loading…</small> : <PrivateDocumentList client={client} documents={documents} />)}
  </div>
}

