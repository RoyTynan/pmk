'use client'
import { useEffect, useState } from 'react'
import styles from './TracesTab.module.css'

const BASE = '/api'

interface TraceSummary {
  id:          string
  timestamp:   string
  llm_name:    string
  prompt:      string
  result:      'passed' | 'failed'
  attempts:    number
  duration_ms: number
}

interface AttemptDetail {
  attempt:     number
  generate_ms: number
  extract_ms:  number
  execute_ms:  number
  code:        string
  output:      string
  error:       string
  passed:      boolean
}

interface TraceDetail extends TraceSummary {
  attempts_list: AttemptDetail[]
}

export default function TracesTab({ visible }: { visible: boolean }) {
  const [traces,      setTraces]      = useState<TraceSummary[]>([])
  const [total,       setTotal]       = useState(0)
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [detail,      setDetail]      = useState<TraceDetail | null>(null)
  const [filter,      setFilter]      = useState<'all' | 'passed' | 'failed'>('all')
  const [loading,     setLoading]     = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => { if (visible) load() }, [visible])

  async function load() {
    setLoading(true)
    const r = await fetch(`${BASE}/traces`)
    const j = await r.json()
    setTraces(j.traces)
    setTotal(j.total)
    setLoading(false)
  }

  async function expand(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return }
    setExpanded(id)
    const r = await fetch(`${BASE}/traces/${id}`)
    const j = await r.json()
    setDetail({ ...j, attempts_list: j.attempts })
  }

  async function clearAll() {
    await fetch(`${BASE}/traces`, { method: 'DELETE' })
    setTraces([]); setTotal(0); setExpanded(null); setDetail(null)
    setConfirmClear(false)
  }

  const filtered = traces.filter(t => filter === 'all' || t.result === filter)

  return (
    <div className={styles.container}>
      <h2>agentic traces</h2>
      <p className={styles.subtitle}>
        A record of every agentic tab run — each node, timing, code, and output.
      </p>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {(['all', 'passed', 'failed'] as const).map(f => (
            <button
              key={f}
              className={`btn small ${filter === f ? styles.activeFilter : ''}`}
              onClick={() => setFilter(f)}
            >{f}</button>
          ))}
          <button className="btn small" onClick={load}>refresh</button>
          <span className={styles.count}>{total} run{total !== 1 ? 's' : ''} recorded</span>
        </div>
        {total > 0 && (
          <button className="btn small red" onClick={() => setConfirmClear(true)}>clear all</button>
        )}
      </div>

      {confirmClear && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <p>Delete all {total} trace{total !== 1 ? 's' : ''}? This cannot be undone.</p>
            <div className={styles.dialogButtons}>
              <button className="btn red" onClick={clearAll}>delete</button>
              <button className="btn" onClick={() => setConfirmClear(false)}>cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className={styles.empty}>loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.empty}>
          {total === 0
            ? 'No traces yet — run something in the agentic tab.'
            : 'No traces match the current filter.'}
        </div>
      )}

      <div className={styles.list}>
        {filtered.map(t => (
          <div key={t.id} className={styles.row}>
            <div className={styles.rowHeader} onClick={() => expand(t.id)}>
              <span className={`${styles.badge} ${styles[t.result]}`}>{t.result}</span>
              <span className={styles.ts}>{t.timestamp.replace('T', ' ')}</span>
              <span className={styles.llm}>{t.llm_name}</span>
              <span className={styles.prompt}>{t.prompt.slice(0, 80)}{t.prompt.length > 80 ? '…' : ''}</span>
              <span className={styles.meta}>{t.attempts} attempt{t.attempts !== 1 ? 's' : ''}</span>
              <span className={styles.meta}>{(t.duration_ms / 1000).toFixed(1)}s</span>
              <span className={styles.chevron}>{expanded === t.id ? '▲' : '▼'}</span>
            </div>

            {expanded === t.id && detail?.id === t.id && (
              <div className={styles.detail}>
                <div className={styles.promptFull}>{detail.prompt}</div>

                {(detail.attempts_list ?? []).map((a, i) => (
                  <div key={i} className={`${styles.attempt} ${a.passed ? styles.attemptPassed : styles.attemptFailed}`}>
                    <div className={styles.attemptHeader}>
                      <span>attempt {a.attempt}</span>
                      <span className={`${styles.badge} ${a.passed ? styles.passed : styles.failed}`}>
                        {a.passed ? 'passed' : 'failed'}
                      </span>
                      <span className={styles.timing}>
                        generate {a.generate_ms}ms · extract {a.extract_ms}ms · execute {a.execute_ms}ms
                      </span>
                    </div>

                    {a.code && (
                      <pre className={styles.code}>{a.code}</pre>
                    )}
                    {a.output && (
                      <div className={styles.output}>▶ {a.output}</div>
                    )}
                    {a.error && (
                      <div className={styles.error}>{a.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
