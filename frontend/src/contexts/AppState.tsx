'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api, type Task, type LLM, type ActivityEntry } from '@/lib/api'

export interface AppState {
  tasks:     Task[]
  activity:  ActivityEntry[]
  llms:      LLM[]
  kernel:    { running: boolean }
  multi:     { enabled: boolean }
  connected: boolean
}

const defaultState: AppState = {
  tasks:     [],
  activity:  [],
  llms:      [],
  kernel:    { running: false },
  multi:     { enabled: false },
  connected: false,
}

const Ctx = createContext<AppState>(defaultState)

export function useAppState() {
  return useContext(Ctx)
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState)
  const wsRef      = useRef<WebSocket | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dead       = useRef(false)

  function connect() {
    if (typeof window === 'undefined' || dead.current) return

    // Connect to the same host:port as the page — proxied by the custom server
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws    = new WebSocket(`${proto}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setState(s => ({ ...s, connected: true }))

    ws.onmessage = e => {
      const d = JSON.parse(e.data) as Partial<AppState>
      setState(s => ({
        ...s,
        tasks:    d.tasks    ?? s.tasks,
        activity: d.activity ?? s.activity,
        llms:     d.llms     ?? s.llms,
        kernel:   d.kernel   ?? s.kernel,
        multi:    d.multi    ?? s.multi,
      }))
    }

    ws.onclose = () => {
      setState(s => ({ ...s, connected: false }))
      if (!dead.current) retryTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    dead.current = false
    api.multiOff()   // reset multi mode on every fresh page load
    connect()
    return () => {
      dead.current = true
      if (retryTimer.current) clearTimeout(retryTimer.current)
      wsRef.current?.close()
    }
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
