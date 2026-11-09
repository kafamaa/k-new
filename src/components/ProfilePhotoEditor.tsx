import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RotateCcw, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react'

export type PhotoFit = { zoom: number; x: number; y: number; auto: boolean }

const DEFAULT_FIT: PhotoFit = { zoom: 1, x: 0, y: 0, auto: true }
const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

function extFor(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

export function ProfilePhotoEditor({
  client,
  playerId,
  currentUrl,
  currentFit,
  onSaved,
  onRemoved,
  onCancel,
}: {
  client: SupabaseClient
  playerId: string
  currentUrl: string | null
  currentFit: PhotoFit | null
  onSaved: (url: string, path: string, fit: PhotoFit) => void
  onRemoved: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fit, setFit] = useState<PhotoFit>(currentFit ?? DEFAULT_FIT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const dragStart = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const displayUrl = previewUrl ?? currentUrl

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0] ?? null
    setError('')
    if (!f) return
    if (!ACCEPT.split(',').includes(f.type)) { setError('Only PNG, JPG/JPEG or WebP are allowed.'); return }
    if (f.size > MAX_BYTES) { setError('Maximum size is 5 MB.'); return }
    if (f.size === 0) { setError('The selected file is empty.'); return }
    setFile(f)
    setFit({ ...DEFAULT_FIT })
  }

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    setFit(prev => ({ ...prev, auto: false, zoom: Math.min(4, Math.max(0.5, prev.zoom + (event.deltaY < 0 ? 0.1 : -0.1))) }))
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (fit.auto) return
    dragStart.current = { x: event.clientX, y: event.clientY, fx: fit.x, fy: fit.y }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return
    const dx = event.clientX - dragStart.current.x
    const dy = event.clientY - dragStart.current.y
    setFit(prev => ({ ...prev, x: dragStart.current!.fx + dx, y: dragStart.current!.fy + dy }))
  }
  const onPointerUp = () => { setDragging(false); dragStart.current = null }

  // Pinch-to-zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let lastDist = 0
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.hypot(dx, dy)
        if (lastDist) {
          const delta = dist - lastDist
          setFit(prev => ({ ...prev, auto: false, zoom: Math.min(4, Math.max(0.5, prev.zoom + delta / 200)) }))
        }
        lastDist = dist
      }
    }
    const onTouchEnd = () => { lastDist = 0 }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => { el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onTouchEnd) }
  }, [])

  const save = async () => {
    if (!file) { setError('Choose a photo first.'); return }
    setBusy(true); setError('')
    try {
      const path = `players/${playerId}/photo-${crypto.randomUUID()}.${extFor(file.type)}`
      const upload = await client.storage.from('public-media').upload(path, file, { contentType: file.type, upsert: false })
      if (upload.error) throw new Error(upload.error.message)
      const { data: urlData } = client.storage.from('public-media').getPublicUrl(path)
      const url = urlData?.publicUrl ?? ''
      const finalFit: PhotoFit = fit.auto ? { ...fit, zoom: 1, x: 0, y: 0 } : fit
      const { error: rpcError } = await client.rpc('set_unclaimed_player_photo', {
        p_player_id: playerId,
        p_photo_path: path,
        p_photo_url: url,
        p_photo_fit: finalFit,
      })
      if (rpcError) throw new Error(rpcError.message)
      // Revoke preview url handled by cleanup on unmount; revoke now.
      onSaved(url, path, finalFit)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!currentUrl && !currentFit) return
    setBusy(true); setError('')
    try {
      const { error: rpcError } = await client.rpc('remove_unclaimed_player_photo', { p_player_id: playerId })
      if (rpcError) throw new Error(rpcError.message)
      onRemoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed.')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => setFit({ ...DEFAULT_FIT })

  const transform = fit.auto
    ? 'scale(1) translate(0px, 0px)'
    : `scale(${fit.zoom}) translate(${fit.x / fit.zoom}px, ${fit.y / fit.zoom}px)`

  return (
    <div className="profile-photo-editor">
      <div className="profile-photo-preview" ref={containerRef} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <div className="profile-photo-circle">
          {displayUrl ? <img src={displayUrl} alt="Player photo" style={{ transform }} draggable={false} /> : <span className="profile-photo-fallback">?</span>}
        </div>
      </div>
      <div className="profile-photo-controls">
        {!fit.auto && <>
          <button type="button" className="outline-button dark" onClick={() => setFit(p => ({ ...p, zoom: Math.min(4, p.zoom + 0.1) }))}><ZoomIn size={14} /></button>
          <button type="button" className="outline-button dark" onClick={() => setFit(p => ({ ...p, zoom: Math.max(0.5, p.zoom - 0.1) }))}><ZoomOut size={14} /></button>
        </>}
        <label className="profile-photo-auto"><input type="checkbox" checked={fit.auto} onChange={e => setFit(p => ({ ...p, auto: e.target.checked }))} /> Auto fit</label>
        <button type="button" className="outline-button dark" onClick={reset}><RotateCcw size={14} /> Reset</button>
      </div>
      <div className="profile-photo-actions">
        <label className="outline-button dark"><Upload size={14} /> {file ? 'Replace photo' : 'Upload photo'}<input type="file" accept={ACCEPT} className="sr-only" onChange={onFileChange} disabled={busy} /></label>
        {(currentUrl || file) && !confirmRemove && <button type="button" className="outline-button dark" disabled={busy} onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Remove photo</button>}
        {confirmRemove && <span className="confirm-group"><span>Remove this photo?</span><button type="button" className="primary-button record-delete-confirm" disabled={busy} onClick={() => { setConfirmRemove(false); void remove() }}>Yes, remove</button><button type="button" className="outline-button dark" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button></span>}
        <button type="button" className="primary-button" disabled={busy || !file} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="outline-button dark" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <p className="field-hint">PNG, JPG/JPEG or WebP, max 5 MB. Drag to pan, scroll to zoom. Auto fit shows the complete photo.</p>
    </div>
  )
}