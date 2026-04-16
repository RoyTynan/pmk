'use client'
import { createContext, useContext, useRef, useState } from 'react'

interface ModalCtx {
  show: (title: string, message: string) => Promise<boolean>
}

const Ctx = createContext<ModalCtx>({ show: async () => false })

export function useModal() {
  return useContext(Ctx)
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ title: string; message: string } | null>(null)
  const resolveRef = useRef<(v: boolean) => void>(() => {})

  function show(title: string, message: string): Promise<boolean> {
    setState({ title, message })
    return new Promise(resolve => { resolveRef.current = resolve })
  }

  function close(result: boolean) {
    setState(null)
    resolveRef.current(result)
  }

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {state && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#1a1a1a', border: '1px solid #444', borderRadius: 5,
            padding: '1.5rem 2rem', maxWidth: 420, width: '90%', fontFamily: 'monospace',
          }}>
            <div style={{ color: '#7af', fontSize: '1rem', marginBottom: '0.8rem' }}>{state.title}</div>
            <div style={{ color: '#ccc', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '1.2rem', whiteSpace: 'pre-wrap' }}>{state.message}</div>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => close(false)}>cancel</button>
              <button className="btn red" onClick={() => close(true)}>confirm</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
