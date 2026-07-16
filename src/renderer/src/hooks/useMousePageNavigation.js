import { useCallback, useEffect, useRef } from 'react'
import { createMousePageDirectionGate, getAppCommandPageDirection, getMousePageDirection } from '@/lib/mouse-page-nav'

export function useMousePageNavigation({ active, onDirection }) {
  const rootRef = useRef(null)
  const directionRef = useRef(onDirection)
  const gateRef = useRef(null)
  directionRef.current = onDirection
  if (!gateRef.current) gateRef.current = createMousePageDirectionGate()

  const onMouseUpCapture = useCallback(
    (event) => {
      if (!active) return
      const direction = getMousePageDirection(event.button)
      if (!direction || !gateRef.current(direction)) return
      event.preventDefault()
      event.stopPropagation()
      directionRef.current(direction, event.target, event.currentTarget)
    },
    [active],
  )

  useEffect(() => {
    if (!active) return undefined
    return window.api.on('app-command', (command) => {
      const direction = getAppCommandPageDirection(command)
      if (!direction || !gateRef.current(direction)) return
      directionRef.current(direction, rootRef.current, rootRef.current)
    })
  }, [active])

  return { rootRef, onMouseUpCapture }
}
