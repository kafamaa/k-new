import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { imageLimit } from '../../lib/appConfig'

export type UploadStatus = 'idle' | 'selected' | 'uploading' | 'saved' | 'error'

export type ImageUploaderProps = {
  label: string
  hint?: string
  accept?: string
  maxSizeBytes?: number
  currentUrl?: string | null
  status?: UploadStatus
  progress?: number
  error?: string | null
  onSelect: (file: File) => void
  onRemove?: () => void
  onRetry?: () => void
  disabled?: boolean
}

const DEFAULT_ACCEPT = 'image/png,image/jpeg,image/webp'

export function ImageUploader({
  label, hint, accept = DEFAULT_ACCEPT, maxSizeBytes = 2 * 1024 * 1024,
  currentUrl, status = 'idle', progress = 0, error, onSelect, onRemove, onRetry, disabled,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  const handleFile = (file: File | null) => {
    if (!file) return
    if (!accept.split(',').map(s => s.trim()).includes(file.type)) {
      onSelect(file) // let parent validate/show error
      return
    }
    if (file.size > imageLimit(maxSizeBytes)) {
      onSelect(file)
      return
    }
    const url = URL.createObjectURL(file)
    setLocalPreview(url)
    onSelect(file)
  }

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0] ?? null)
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFile(event.dataTransfer.files?.[0] ?? null)
  }

  const preview = localPreview ?? currentUrl ?? null
  const fallbackInitials = label.trim().slice(0, 2).toUpperCase()

  return (
    <div className={`upload-card image-uploader ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <div className="upload-preview square" aria-hidden="true">
        {preview ? <img src={preview} alt={`${label} preview`} style={{ objectFit: 'cover' }} /> : <span className="upload-fallback">{fallbackInitials}</span>}
      </div>
      <div className="upload-body">
        <label className="upload-label">{label}
          <input ref={inputRef} type="file" accept={accept} onChange={onInputChange} disabled={disabled} className="sr-only" aria-label={label} />
        </label>
        <button type="button" className="outline-button dark small" onClick={() => inputRef.current?.click()} disabled={disabled}>Choose file</button>
        <p className="upload-hint">{hint ?? `Accepted: ${accept.replace(/image\//g, '').toUpperCase()}. Max ${Math.round(imageLimit(maxSizeBytes) / (1024 * 1024))} MB.`}</p>
        {status === 'uploading' ? <div className="upload-progress" role="status" aria-live="polite"><span style={{ width: `${progress}%` }} /><small>Uploading… {progress}%</small></div> : null}
        {status === 'saved' ? <small className="upload-state saved">Saved</small> : null}
        {status === 'error' && error ? <small className="upload-state error" role="alert">{error}</small> : null}
        <div className="button-row compact">
          {currentUrl && onRemove ? <button type="button" className="ghost-button" onClick={onRemove} disabled={disabled}>Remove</button> : null}
          {status === 'error' && onRetry ? <button type="button" className="ghost-button" onClick={onRetry} disabled={disabled}>Retry</button> : null}
        </div>
      </div>
    </div>
  )
}
