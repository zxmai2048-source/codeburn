import { useEffect, useRef, useState } from 'react'

import { ProviderLogo } from './ProviderLogo'

export type ProviderOption = { value: string; label: string }

/** Provider selector populated from providers detected in the CLI payload. */
export function ProviderPop({
  value,
  label,
  options,
  onSelect,
}: {
  value: string
  label: string
  options: ProviderOption[]
  onSelect: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="pop-wrap" ref={wrapRef}>
      <div
        className="pop"
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(current => !current)
          }
        }}
      >
        <ProviderLogo provider={value} />{label}
      </div>
      {open && (
        <div className="pop-menu" role="listbox" aria-label="Providers">
          {options.map(option => (
            <div
              key={option.value}
              className={`pop-item${option.value === value ? ' on' : ''}`}
              role="option"
              tabIndex={0}
              aria-selected={option.value === value}
              onClick={() => {
                onSelect(option.value)
                setOpen(false)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(option.value)
                  setOpen(false)
                }
              }}
            >
              <ProviderLogo provider={option.value} />{option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
