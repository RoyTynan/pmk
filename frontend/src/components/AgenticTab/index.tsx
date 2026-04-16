'use client'
import { useEffect, useState } from 'react'
import { useAppState } from '@/contexts/AppState'
import styles from './AgenticTab.module.css'

const BASE = '/api'

// --- run interfaces ---
interface Attempt {
  attempt: number
  status:  'generating' | 'executing' | 'passed' | 'failed'
  code?:   string
  output?: string
  error?:  string
}

interface DoneEvent {
  done:    true
  passed:  boolean
  code:    string
  output:  string
  attempt: number
}

// --- trace interfaces ---
interface TraceRow {
  id:          string
  timestamp:   string
  llm_name:    string
  prompt:      string
  result:      'passed' | 'failed'
  duration_ms: number
  attempt:     number
  code:        string
  output:      string
  error:       string
  generate_ms: number
  extract_ms:  number
  execute_ms:  number
}

export default function AgenticTab() {
  const { llms } = useAppState()
  const allLlms  = llms.filter(l => l.running || l.type === 'remote')

  // run state
  const [llmName,    setLlmName]    = useState('')
  const [maxRetries, setMaxRetries] = useState(3)
  const [prompt,     setPrompt]     = useState('')
  const [running,    setRunning]    = useState(false)
  const [attempts,   setAttempts]   = useState<Attempt[]>([])
  const [done,       setDone]       = useState<DoneEvent | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  // history state
  const [traces,       setTraces]       = useState<TraceRow[]>([])
  const [total,        setTotal]        = useState<number | null>(null)
  const [filter,       setFilter]       = useState<'all' | 'passed' | 'failed'>('all')
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => { loadTraces() }, [])

  // --- run ---
  function reset() { setAttempts([]); setDone(null) }

  function upsertAttempt(update: Partial<Attempt> & { attempt: number }) {
    setAttempts(prev => {
      const idx = prev.findIndex(a => a.attempt === update.attempt)
      if (idx === -1) return [...prev, update as Attempt]
      const updated = [...prev]
      updated[idx] = { ...updated[idx], ...update }
      return updated
    })
  }

  async function run() {
    if (!llmName)       { setError('select an LLM first'); return }
    if (!prompt.trim()) { setError('enter a prompt'); return }
    setError(null)
    setFilter('all')
    reset()
    setRunning(true)

    const resp = await fetch(`${BASE}/agentic/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prompt: prompt.trim(), llm_name: llmName, max: maxRetries }),
    })

    const reader  = resp.body!.getReader()
    const decoder = new TextDecoder()
    let   buffer  = ''

    while (true) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const event = JSON.parse(line.slice(6))
        if (event.done) {
          setDone(event as DoneEvent)
        } else {
          upsertAttempt(event as Attempt)
        }
      }
    }

    setRunning(false)
    loadTraces()
  }

  // --- history ---
  async function loadTraces() {
    setTraceLoading(true)
    const r = await fetch(`${BASE}/traces`)
    const j = await r.json()
    setTraces(j.traces)
    setTotal(j.total)
    setTraceLoading(false)
  }

  function toggleTrace(id: string) {
    setExpanded(prev => prev === id ? null : id)
  }

  async function clearTraces() {
    await fetch(`${BASE}/traces`, { method: 'DELETE' })
    setTraces([]); setTotal(0); setExpanded(null)
    setConfirmClear(false)
  }

  const filtered = traces.filter(t => filter === 'all' || t.result === filter)

  return (
    <div className={styles.container}>

      {/* ── run panel ── */}
      <h2>agentic code generation</h2>
      <p style={{ fontSize: '1rem', color: '#666', marginTop: '-0.3rem', marginBottom: '0.8rem' }}>
        Python only — generated code is executed and verified; failed attempts are retried with the error fed back to the LLM.
      </p>

      <div className={styles.controls}>
        <label>
          LLM
          <select value={llmName} onChange={e => { setLlmName(e.target.value); setError(null) }} style={{ minWidth: 180 }}>
            <option value="">— select —</option>
            {allLlms.map(l => (
              <option key={l.name} value={l.name}>{l.name} ({l.type})</option>
            ))}
          </select>
        </label>
        <label>
          max retries
          <input
            type="number" min={1} max={10} style={{ width: 60 }}
            value={maxRetries} onChange={e => setMaxRetries(Number(e.target.value))}
          />
        </label>
        <button className="btn green" onClick={run} disabled={running}>
          {running ? 'running…' : 'run'}
        </button>
        {(attempts.length > 0 || done) && !running && (
          <button className="btn" onClick={reset}>clear</button>
        )}
        {error && <span className={styles.inputError}>{error}</span>}
      </div>

      <div className={styles.promptWrap}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' , fontSize : '1rem'}}>
          {[
            'Calculate the first 20 Fibonacci numbers and print them as a list.',
            'Write a function that checks if a number is prime. Test it on 17, 42, and 97.',
            'Sort a list of words alphabetically and print the result.',
            'Count how many vowels are in the sentence "The quick brown fox jumps over the lazy dog" and print the count.',
            'Calculate the factorial of 10 and print the result.',
            'Write a function that reverses a string. Test it with "hello world".',
            'Write a C++ function that adds two integers and prints the result of adding 5 and 3.',
          ].map(p => (
            <button
              key={p}
              onClick={() => setPrompt(p)}
              style={{ fontFamily: 'monospace', fontSize: '1rem', color: '#666', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 3, padding: '0.2rem 0.5rem', cursor: 'pointer' }}
              onMouseOver={e => { (e.target as HTMLElement).style.color = '#aaa'; (e.target as HTMLElement).style.borderColor = '#555' }}
              onMouseOut={e => { (e.target as HTMLElement).style.color = '#666'; (e.target as HTMLElement).style.borderColor = '#2a2a2a' }}
            >{p}</button>
          ))}
        </div>
        <textarea
          placeholder="Describe the Python code you want generated… (Python only — code is executed and verified)"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
      </div>

      {attempts.length > 0 && (
        <div className={styles.attempts}>
          {attempts.map(a => (
            <div key={a.attempt} className={styles.card}>
              <div className={styles.cardHeader}>
                <span>attempt {a.attempt}</span>
                <span className={`${styles.badge} ${styles[a.status]}`}>{a.status}</span>
              </div>
              {a.code   && <pre className={styles.code}>{a.code}</pre>}
              {a.output && <div className={styles.output}>▶ {a.output}</div>}
              {a.error  && <div className={styles.error}>✗ {a.error}</div>}
            </div>
          ))}
        </div>
      )}

      {done && (
        <div className={`${styles.summary} ${done.passed ? styles.passed : styles.failed}`}>
          {done.passed
            ? `✓ passed on attempt ${done.attempt}`
            : `✗ gave up after ${done.attempt} attempt${done.attempt > 1 ? 's' : ''}`}
        </div>
      )}

      {/* ── history panel ── */}
      <div className={styles.divider} />

      <div className={styles.historyToolbar}>
        <div className={styles.historyFilters}>
          {(['all', 'passed', 'failed'] as const).map(f => (
            <button
              key={f}
              className={`btn small ${filter === f ? styles.activeFilter : ''}`}
              onClick={() => setFilter(f)}
            >{f}</button>
          ))}
          <button className="btn small" onClick={loadTraces}>refresh</button>
          {total !== null && <span className={styles.historyCount}>{total} attempt{total !== 1 ? 's' : ''} recorded</span>}
        </div>
        {!!total && (
          <button className="btn small red" onClick={() => setConfirmClear(true)}>clear all</button>
        )}
      </div>

      {traceLoading && <div className={styles.historyEmpty}>loading…</div>}

      {!traceLoading && filtered.length === 0 && (
        <div className={styles.historyEmpty}>
          {total === 0 ? 'No runs recorded yet.' : 'No runs match the current filter.'}
        </div>
      )}

      <div className={styles.historyList}>
        {filtered.map(t => (
          <div key={t.id} className={styles.traceRow}>
            <div className={styles.traceHeader} onClick={() => toggleTrace(t.id)}>
              <span className={`${styles.traceBadge} ${styles[t.result]}`}>{t.result}</span>
              <span className={styles.traceTs}>{t.timestamp.replace('T', ' ')}</span>
              <span className={styles.traceLlm}>{t.llm_name}</span>
              <span className={styles.tracePrompt}>{t.prompt.slice(0, 80)}{t.prompt.length > 80 ? '…' : ''}</span>
              <span className={styles.traceMeta}>attempt {t.attempt}</span>
              <span className={styles.traceMeta}>{(t.duration_ms / 1000).toFixed(1)}s</span>
              <span className={styles.traceChevron}>{expanded === t.id ? '▲' : '▼'}</span>
            </div>

            {expanded === t.id && (
              <div className={styles.traceDetail}>
                <div className={styles.traceAttemptHeader}>
                  <span className={styles.traceTiming}>
                    generate {t.generate_ms}ms · extract {t.extract_ms}ms · execute {t.execute_ms}ms
                  </span>
                </div>
                {t.code   && <pre className={styles.code}>{t.code}</pre>}
                {t.output && <div className={styles.output}>▶ {t.output}</div>}
                {t.error  && <div className={styles.error}>{t.error}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {confirmClear && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <p>Delete all {total ?? 0} attempt{total !== 1 ? 's' : ''}? This cannot be undone.</p>
            <div className={styles.dialogButtons}>
              <button className="btn red" onClick={clearTraces}>delete</button>
              <button className="btn" onClick={() => setConfirmClear(false)}>cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
