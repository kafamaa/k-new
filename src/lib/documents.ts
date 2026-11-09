import type { SupabaseClient } from '@supabase/supabase-js'

// Private tournament documents (identity, payment proof, consent forms). The
// bucket is private; a viewer gets a short-lived signed URL only when the
// storage policy lets them read the object (tournament operator or the
// entry's team manager). Links expire quickly so they cannot be passed around.
export const DOCUMENT_BUCKET = 'tournament-private-documents'
export const DOCUMENT_LINK_SECONDS = 60

export type PrivateDocument = { id: string; entryId: string | null; documentType: string; storagePath: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }

export async function loadEntryDocuments(client: SupabaseClient, entryId: string): Promise<{ data: PrivateDocument[]; error: string | null }> {
  const result = await client.from('private_documents').select('id,entry_id,document_type,storage_path,original_name,mime_type,size_bytes,created_at').eq('entry_id', entryId).order('created_at', { ascending: false })
  if (result.error) return { data: [], error: result.error.message }
  return { data: ((result.data ?? []) as Array<Record<string, unknown>>).map(toDocument), error: null }
}

export function toDocument(row: Record<string, unknown>): PrivateDocument {
  return { id: String(row.id), entryId: row.entry_id ? String(row.entry_id) : null, documentType: String(row.document_type ?? ''), storagePath: String(row.storage_path ?? ''), originalName: String(row.original_name ?? 'Document'), mimeType: String(row.mime_type ?? ''), sizeBytes: Number(row.size_bytes ?? 0), createdAt: String(row.created_at ?? '') }
}

export async function privateDocumentLink(client: SupabaseClient, storagePath: string): Promise<{ url: string | null; error: string | null }> {
  if (!storagePath) return { url: null, error: 'This document has no stored file.' }
  const result = await client.storage.from(DOCUMENT_BUCKET).createSignedUrl(storagePath, DOCUMENT_LINK_SECONDS)
  if (result.error || !result.data?.signedUrl) return { url: null, error: result.error?.message ?? 'The document could not be opened.' }
  return { url: result.data.signedUrl, error: null }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
