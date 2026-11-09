import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { documentLimit } from '../../lib/appConfig'

export type DocumentUploaderProps = {
  label: string
  hint?: string
  accept?: string
  maxSizeBytes?: number
  currentName?: string | null
  status?: 'idle' | 'selected' | 'uploading' | 'saved' | 'error'
  progress?: number
  error?: string | null
  onSelect: (file: File) => void
  onRemove?: () => void
  onRetry?: () => void
  disabled?: boolean
}

const DEFAULT_ACCEPT = 'application/pdf,image/png,image/jpeg'

export function DocumentUploader({
  label, hint, accept = DEFAULT_ACCEPT, maxSizeBytes = 10 * 1024 * 1024,
  currentName, status = 'idle', progress = 0, error, onSelect, onRemove, onRetry, disabled,
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  const handleFile = (file: File | null) => {
    if (!file) return
    setSelectedName(file.name)
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

  return (
    <div className={`upload-card document-uploader ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <div className="upload-file-icon" aria-hidden="true">📄</div>
      <div className="upload-body">
        <label className="upload-label">{label}
          <input ref={inputRef} type="file" accept={accept} onChange={onInputChange} disabled={disabled} className="sr-only" aria-label={label} />
        </label>
        <button type="button" className="outline-button dark small" onClick={() => inputRef.current?.click()} disabled={disabled}>Choose file</button>
        <p className="upload-hint">{hint ?? `Accepted: PDF, PNG, JPG. Max ${Math.round(documentLimit(maxSizeBytes) / (1024 * 1024))} MB.`}</p>
        {selectedName ? <small>Selected: {selectedName}</small> : (currentName ? <small>Saved: {currentName}</small> : <small>No file yet.</small>)}
        {status === 'uploading' ? <div className="upload-progress" role="status" aria-live="polite"><span style={{ width: `${progress}%` }} /><small>Uploading… {progress}%</small></div> : null}
        {status === 'saved' ? <small className="upload-state saved">Saved</small> : null}
        {status === 'error' && error ? <small className="upload-state error" role="alert">{error}</small> : null}
        <div className="button-row compact">
          {currentName && onRemove ? <button type="button" className="ghost-button" onClick={onRemove} disabled={disabled}>Remove</button> : null}
          {status === 'error' && onRetry ? <button type="button" className="ghost-button" onClick={onRetry} disabled={disabled}>Retry</button> : null}
        </div>
      </div>
    </div>
  )
}
