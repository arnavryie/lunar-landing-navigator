import { useEffect, useRef, useState } from 'react'
import type { Site } from '../data'
import { getCardContent, type Topic } from './cards'
import '../styles/explain.css'

export function Why({ topic, site, i }: { topic: Topic; site: Site; i: number }) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
    } else {
      if (dialog.open) dialog.close()
    }
  }, [open])

  const content = getCardContent(topic, site, i)

  return (
    <>
      <button
        type="button"
        className="why-pill"
        onClick={() => setOpen(true)}
        title={`Why: ${content.title}`}
        aria-label={`Why: ${content.title}`}
      >
        Why?
      </button>

      <dialog
        ref={dialogRef}
        className="why-dialog"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false)
        }}
      >
        <div className="why-card">
          <div className="why-header">
            <h3>{content.title}</h3>
            <button
              type="button"
              className="why-close"
              onClick={() => setOpen(false)}
              aria-label="Close explainer"
            >
              ✕
            </button>
          </div>

          <div className="why-body">
            <p className="why-text">{content.explanation}</p>
            <div className="why-diagram-wrap">{content.diagram}</div>
          </div>

          <div className="why-footer">
            <span className="why-live-label">{content.liveLabel}</span>
            <span className="why-live-val">{content.liveValue}</span>
          </div>
        </div>
      </dialog>
    </>
  )
}
