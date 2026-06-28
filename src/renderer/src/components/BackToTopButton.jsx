import { useEffect, useState } from 'react'
import { ChevronUp } from 'lucide-react'

export default function BackToTopButton({ scrollRef, threshold = 400, className = '' }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setVisible(el.scrollTop > threshold)
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [scrollRef, threshold])

  const scrollTop = () => {
    const el = scrollRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0, behavior: 'smooth' })
    else el.scrollTop = 0
  }

  return (
    <button
      type="button"
      title="Back to top"
      aria-label="Back to top"
      onClick={scrollTop}
      className={`absolute bottom-4 right-4 z-20 inline-flex size-9 items-center justify-center rounded-full border border-border bg-elevated/95 text-text-secondary shadow-lg backdrop-blur-sm transition-opacity hover:bg-hover hover:text-text-primary ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      } ${className}`}
    >
      <ChevronUp size={18} />
    </button>
  )
}
