'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAppState } from '@/contexts/AppState'
import styles from './MultiTab.module.css'

interface Step {
  prompt: string
  name:   string   // LLM name — url+model resolved at run time
}

interface StepResult {
  status: 'idle' | 'running' | 'done' | 'error'
  result: string
}

export default function MultiTab() {
  const { llms } = useAppState()
  const localLlms = llms.filter(l => l.type === 'local')
  const allLlms   = llms

  const [steps, setSteps]     = useState<Step[]>([
    { prompt: '', name: '' },
    { prompt: '', name: '' },
  ])
  const [results, setResults] = useState<StepResult[]>([])
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<{ role: string; content: string }[]>([])
  const [runError, setRunError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // default step instances when LLMs load
  useEffect(() => {
    if (allLlms.length === 0) return
    setSteps(prev => prev.map((s, i) => {
      if (s.name) return s
      return { ...s, name: allLlms[i % allLlms.length].name }
    }))
  }, [llms])

  function setStep(i: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  function addStep() {
    const llm = allLlms[steps.length % allLlms.length]
    setSteps(prev => [...prev, { prompt: '', name: llm?.name ?? '' }])
  }

  function removeStep(i: number) {
    setSteps(prev => prev.filter((_, idx) => idx !== i))
  }

  async function runPipeline() {
    if (running) { abortRef.current?.abort(); setRunning(false); return }
    const hasPrompt = steps.some(s => s.prompt.trim())
    if (!hasPrompt) return
    if (steps.some(s => !s.name)) { setRunError('select a model for each step'); return }
    setRunError(null)
    const valid = steps.filter(s => s.prompt.trim() && s.name)

    setRunning(true)
    setHistory([])
    setResults(valid.map(() => ({ status: 'idle', result: '' })))

    abortRef.current = new AbortController()

    try {
      const resolved = valid.map(s => ({ name: s.name, prompt: s.prompt }))
      const resp = await api.multiPipeline(resolved)
      if (!resp.body) throw new Error('no body')
      const reader = resp.body.getReader()
      const dec    = new TextDecoder()
      let   buf    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const evt = JSON.parse(line.slice(6))

          if (evt.done) {
            setHistory(evt.history ?? [])
          } else {
            setResults(prev => prev.map((r, i) =>
              i === evt.step
                ? { status: evt.status, result: evt.result ?? r.result }
                : r
            ))
          }
        }
      }
    } catch (_) {
      // aborted or network error — leave results as-is
    } finally {
      setRunning(false)
    }
  }

  async function startLlm(name: string) { await api.llmStart(name) }
  async function stopLlm(name: string)  { await api.llmStop(name) }

  return (
    <div className={styles.wrap}>
      {/* instances */}
      <section className={styles.section}>
        <h2>local instances</h2>
        {localLlms.length === 0
          ? <p className={styles.dim}>no local LLMs registered</p>
          : (
            <div className={styles.instances}>
              {localLlms.map(l => (
                <div key={l.name} className={styles.instance}>
                  <span className={`${styles.dot} ${l.running ? styles.on : styles.off}`}>●</span>
                  <span className={styles.instanceName}>{l.name}</span>
                  <span className={styles.dim}>{l.url}</span>
                  <button
                    className={`btn small ${l.running ? 'red' : 'green'}`}
                    onClick={() => l.running ? stopLlm(l.name) : startLlm(l.name)}
                  >
                    {l.running ? 'stop' : 'start'}
                  </button>
                </div>
              ))}
            </div>
          )
        }
      </section>

      {/* pipeline builder */}
      <section className={styles.section}>
        <h2>pipeline</h2>
        <div className={styles.steps}>
          {steps.map((s, i) => (
            <div key={i} className={styles.step}>
              <span className={styles.stepNum}>{i + 1}</span>
              <textarea
                className={styles.promptBox}
                rows={2}
                placeholder="enter prompt…"
                value={s.prompt}
                onChange={e => setStep(i, { prompt: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) runPipeline() }}
              />
              <select
                className={styles.instanceSelect}
                value={s.name}
                onChange={e => { setStep(i, { name: e.target.value }); setRunError(null) }}
              >
                <option value="">pick instance</option>
                {allLlms.map(l => (
                  <option key={l.name} value={l.name}>
                    {l.name} ({l.type})
                  </option>
                ))}
              </select>
              {results[i] && (
                <div className={`${styles.stepResult} ${styles[results[i].status]}`}>
                  {results[i].status === 'running' && <span className={styles.spinner}>…</span>}
                  {results[i].result}
                </div>
              )}
              {steps.length > 1 && (
                <button className="btn small red" onClick={() => removeStep(i)}>✕</button>
              )}
            </div>
          ))}
        </div>

        <div className={styles.pipelineActions}>
          <button className="btn" onClick={addStep}>+ add step</button>
          <button
            className={`btn ${running ? 'red' : 'blue'}`}
            onClick={runPipeline}
            disabled={steps.every(s => !s.prompt.trim())}
          >
            {running ? '■ stop' : '▶ run'}
          </button>
          {runError && <span className={styles.runError}>{runError}</span>}
        </div>
      </section>

      {/* conversation history */}
      {history.length > 0 && (
        <section className={styles.section}>
          <h2>conversation sent</h2>
          <div className={styles.history}>
            {history.map((m, i) => (
              <div key={i} className={`${styles.msg} ${styles[m.role]}`}>
                <span className={styles.role}>{m.role}</span>
                <span className={styles.msgContent}>{m.content}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
