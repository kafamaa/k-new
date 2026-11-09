import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// A focused confirmation surface for an existing action. Opening or closing
// this dialog never performs a mutation; the caller owns its explicit button.
export function ReviewDialog({ open, title, busy = false, onClose, children }: {
  open: boolean; title: string; busy?: boolean; onClose: () => void; children: ReactNode
}) {
  const heading = useId()
  const dialog = useRef<HTMLElement>(null)
  const current = useRef({ onClose, busy })
  useEffect(() => { current.current = { onClose, busy } }, [onClose, busy])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector<HTMLElement>('[data-dialog-cancel], button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !current.current.busy) { event.preventDefault(); current.current.onClose(); return }
      if (event.key !== 'Tab') return
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]') ?? [])].filter(node => node.getClientRects().length > 0)
      const first = controls[0]; const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [open])
  if (!open) return null
  return createPortal(<div className="review-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><section ref={dialog} className="review-dialog" role="dialog" aria-modal="true" aria-labelledby={heading}><header className="review-dialog-heading"><h2 id={heading}>{title}</h2><button type="button" className="ed-icon-btn" aria-label="Close confirmation" disabled={busy} onClick={onClose}><X size={20} /></button></header>{children}</section></div>, document.body)
}
