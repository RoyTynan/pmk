'use client'
import { useEffect, useState } from 'react'
import { useAppState } from '@/contexts/AppState'
import styles from './RayTab.module.css'

const BASE = '/api'

const PIPE_EXAMPLES = [
  {
    label: 'math chain',
    input: '2 + 2',
    steps: [
      { prompt_template: 'Calculate {input}. Reply with only the number.', llm: '' },
      { prompt_template: 'Take the number {input} and add 3. Reply with only the number.', llm: '' },
      { prompt_template: 'Write one sentence explaining that the final answer is {input}.', llm: '' },
    ],
  },
  {
    label: 'summarise → translate',
    input: 'The Apollo 11 mission in 1969 was the first time humans landed on the Moon. Neil Armstrong and Buzz Aldrin walked on the surface while Michael Collins orbited above.',
    steps: [
      { prompt_template: 'Summarise the following in one sentence: {input}', llm: '' },
      { prompt_template: 'Translate this to French: {input}', llm: '' },
    ],
  },
  {
    label: 'question → facts → explain',
    input: 'What is the speed of light?',
    steps: [
      { prompt_template: 'Answer this question with only the key fact (number and unit if relevant): {input}', llm: '' },
      { prompt_template: 'Given the fact "{input}", write two sentences putting it in everyday context.', llm: '' },
    ],
  },
]

interface TaskResult {
  task_id:  string
  llm:      string
  status:   'running' | 'done' | 'failed'
  result?:  string
  error?:   string
}

interface RayStatus {
  ok:        boolean
  nodes?:    number
  resources?: Record<string, number>
  error?:    string
}

interface BatchRow {
  prompt: string
  llm:    string
}

interface PipeStep {
  prompt_template: string
  llm: string
}

interface PipeResult {
  step:    number
  task_id: string
  llm:     string
  status:  'running' | 'done' | 'failed'
  prompt?: string
  result?: string
  error?:  string
}

export default function RayTab() {
  const { llms } = useAppState()
  const allLlms  = llms.filter(l => l.running || l.type === 'remote')

  const [rayStatus,  setRayStatus]  = useState<RayStatus | null>(null)
  const [running,    setRunning]    = useState(false)
  const [pipeRunning, setPipeRunning] = useState(false)

  // single task
  const [singlePrompt, setSinglePrompt] = useState('')
  const [singleLlm,    setSingleLlm]    = useState('')
  const [singleResult, setSingleResult] = useState<TaskResult | null>(null)

  // batch tasks
  const [batchRows,    setBatchRows]    = useState<BatchRow[]>([
    { prompt: '', llm: '' },
    { prompt: '', llm: '' },
  ])
  const [batchResults, setBatchResults] = useState<TaskResult[]>([])

  // pipeline
  const [pipeInput,   setPipeInput]   = useState('')
  const [pipeSteps,   setPipeSteps]   = useState<PipeStep[]>([
    { prompt_template: 'Summarize the following in 2-3 sentences: {input}', llm: '' },
    { prompt_template: 'Translate this to French: {input}',                 llm: '' },
  ])
  const [pipeResults, setPipeResults] = useState<PipeResult[]>([])

  useEffect(() => {
    fetch(`${BASE}/ray/status`).then(r => r.json()).then(setRayStatus)
  }, [])

  useEffect(() => {
    if (allLlms.length && !singleLlm) setSingleLlm(allLlms[0].name)
    setBatchRows(prev => prev.map((r, i) =>
      r.llm ? r : { ...r, llm: allLlms[i % allLlms.length]?.name ?? '' }
    ))
    setPipeSteps(prev => prev.map((s, i) =>
      s.llm ? s : { ...s, llm: allLlms[i % allLlms.length]?.name ?? '' }
    ))
  }, [llms])

  async function runSingle() {
    if (!singlePrompt.trim() || !singleLlm) return
    setRunning(true)
    setSingleResult({ task_id: '…', llm: singleLlm, status: 'running' })

    const resp = await fetch(`${BASE}/ray/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: singlePrompt.trim(), llm_name: singleLlm }),
    })

    const reader  = resp.body!.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const evt = JSON.parse(line.slice(6))
        if (evt.done) break
        setSingleResult({ task_id: evt.task_id, llm: singleLlm, status: evt.status, result: evt.result, error: evt.error })
      }
    }
    setRunning(false)
  }

  async function runBatch() {
    const valid = batchRows.filter(r => r.prompt.trim() && r.llm)
    if (!valid.length) return
    setRunning(true)
    setBatchResults([])

    const resp = await fetch(`${BASE}/ray/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: valid.map(r => ({ prompt: r.prompt, llm_name: r.llm })) }),
    })

    const reader  = resp.body!.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const evt = JSON.parse(line.slice(6))
        if (evt.done || evt.status === 'dispatching') continue
        setBatchResults(prev => {
          const idx     = prev.findIndex(r => r.task_id === evt.task_id)
          const updated: TaskResult = { task_id: evt.task_id, llm: evt.llm, status: evt.status, result: evt.result, error: evt.error }
          if (idx === -1) return [...prev, updated]
          const next = [...prev]; next[idx] = updated; return next
        })
      }
    }
    setRunning(false)
  }

  async function runPipeline() {
    if (!pipeInput.trim()) return
    const valid = pipeSteps.filter(s => s.prompt_template.trim() && s.llm)
    if (!valid.length) return
    setPipeRunning(true)
    setPipeResults([])

    const resp = await fetch(`${BASE}/ray/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initial_input: pipeInput.trim(),
        steps: valid.map(s => ({ prompt_template: s.prompt_template, llm_name: s.llm })),
      }),
    })

    const reader  = resp.body!.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const evt = JSON.parse(line.slice(6))
        if (evt.done) break
        setPipeResults(prev => {
          const idx     = prev.findIndex(r => r.step === evt.step)
          const updated: PipeResult = { step: evt.step, task_id: evt.task_id, llm: evt.llm, status: evt.status, prompt: evt.prompt, result: evt.result, error: evt.error }
          if (idx === -1) return [...prev, updated]
          const next = [...prev]; next[idx] = updated; return next
        })
      }
    }
    setPipeRunning(false)
  }

  function setBatchRow(i: number, patch: Partial<BatchRow>) {
    setBatchRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  function loadPipeExample(idx: number) {
    const ex = PIPE_EXAMPLES[idx]
    setPipeInput(ex.input)
    setPipeResults([])
    // preserve current LLM selections when loading
    setPipeSteps(prev =>
      ex.steps.map((s, i) => ({ ...s, llm: prev[i]?.llm || allLlms[i % Math.max(allLlms.length, 1)]?.name || '' }))
    )
  }

  function setPipeStep(i: number, patch: Partial<PipeStep>) {
    setPipeSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  return (
    <div className={styles.container}>
      <h2>ray distributed execution</h2>
      <div style={{ fontSize: '0.88rem', color: '#555', marginTop: '-0.3rem', marginBottom: '1.2rem', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <p>
          <span style={{ color: '#7a9abb' }}>Batch (left)</span> — tasks are dispatched to Ray simultaneously and run concurrently.
          Results stream back as each task finishes, so a fast task won&apos;t wait behind a slow one.
          Suited for independent work: fan-out summarisation, parallel scoring, multi-LLM comparison.
        </p>
        <p>
          <span style={{ color: '#7a9abb' }}>Pipeline (right)</span> — steps run sequentially by design.
          Each step&apos;s output becomes the <code style={{ color: '#8cf', fontSize: '0.82rem' }}>{'{input}'}</code> for the next,
          so the order is fixed. Suited for chained reasoning: summarise → translate → critique.
        </p>
        <p style={{ color: '#444' }}>
          Both paths use Ray remote tasks (not actors) dispatched to the local Ray cluster.
          For 2–3 concurrent tasks, llama.cpp with <code style={{ color: '#8cf', fontSize: '0.82rem' }}>--parallel 3</code> is sufficient.
          For higher concurrency or better throughput, vllm is the preferred backend — it handles many parallel requests
          efficiently via PagedAttention and does not require a fixed slot count.
        </p>
      </div>

      {/* ray status */}
      <div className={styles.status}>
        <span className={`${styles.statusDot} ${rayStatus?.ok ? styles.ok : styles.fail}`}>●</span>
        {rayStatus?.ok
          ? <span>Ray running · <span className={styles.info}>{rayStatus.nodes} node{rayStatus.nodes !== 1 ? 's' : ''}</span> · CPUs: <span className={styles.info}>{rayStatus.resources?.CPU ?? '?'}</span></span>
          : <span className={styles.fail}>Ray not available — {rayStatus?.error ?? 'checking…'}</span>
        }
        <button className="btn small" onClick={() =>
          fetch(`${BASE}/ray/status`).then(r => r.json()).then(setRayStatus)
        }>refresh</button>
      </div>

      {/* two-column layout */}
      <div className={styles.columns}>

        {/* LEFT — single + batch */}
        <div className={styles.col}>

          {/* single task */}
          <div className={styles.section}>
            <h3>single task</h3>
            <div className={styles.form}>
              <textarea
                rows={3}
                placeholder="Enter a prompt…"
                value={singlePrompt}
                onChange={e => setSinglePrompt(e.target.value)}
              />
              <div className={styles.controls}>
                <select value={singleLlm} onChange={e => setSingleLlm(e.target.value)} style={{ minWidth: 180 }}>
                  <option value="">— select LLM —</option>
                  {allLlms.map(l => <option key={l.name} value={l.name}>{l.name} ({l.type})</option>)}
                </select>
                <button className="btn green" onClick={runSingle} disabled={running}>
                  {running ? 'running…' : '▶ run'}
                </button>
              </div>
              {singleResult && (
                <div className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span>{singleResult.llm}</span>
                    <span className={`${styles.badge} ${styles[singleResult.status]}`}>{singleResult.status}</span>
                    <span style={{ color: '#444', fontSize: '0.8rem' }}>id: {singleResult.task_id}</span>
                  </div>
                  {singleResult.result && <div className={styles.result}>{singleResult.result}</div>}
                  {singleResult.error  && <div className={styles.error}>{singleResult.error}</div>}
                </div>
              )}
            </div>
          </div>

          {/* batch tasks */}
          <div className={styles.section}>
            <h3>parallel batch — all tasks dispatched simultaneously</h3>
            <div className={styles.form}>
              {batchRows.map((row, i) => (
                <div key={i} className={styles.batchRow}>
                  <span className={styles.stepNum}>{i + 1}</span>
                  <textarea
                    rows={2}
                    placeholder="Enter a prompt…"
                    value={row.prompt}
                    onChange={e => setBatchRow(i, { prompt: e.target.value })}
                  />
                  <select value={row.llm} onChange={e => setBatchRow(i, { llm: e.target.value })}>
                    <option value="">— select LLM —</option>
                    {allLlms.map(l => <option key={l.name} value={l.name}>{l.name} ({l.type})</option>)}
                  </select>
                  {batchRows.length > 1 && (
                    <button className="btn small red" onClick={() => setBatchRows(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                  )}
                </div>
              ))}
              <div className={styles.controls}>
                <button className="btn" onClick={() => setBatchRows(prev => [...prev, { prompt: '', llm: allLlms[0]?.name ?? '' }])}>+ add task</button>
                <button className="btn green" onClick={runBatch} disabled={running}>
                  {running ? 'running…' : '▶ run all'}
                </button>
              </div>

              {batchResults.length > 0 && (
                <div className={styles.results}>
                  {batchResults.map((r, i) => (
                    <div key={r.task_id} className={styles.card}>
                      <div className={styles.cardHeader}>
                        <span>task {i + 1}</span>
                        <span>{r.llm}</span>
                        <span className={`${styles.badge} ${styles[r.status]}`}>{r.status}</span>
                        <span style={{ color: '#444', fontSize: '0.8rem' }}>id: {r.task_id}</span>
                      </div>
                      {r.result && <div className={styles.result}>{r.result}</div>}
                      {r.error  && <div className={styles.error}>{r.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — pipeline */}
        <div className={styles.col}>
          <div className={styles.section}>
            <h3>chained pipeline — each step feeds the next via &#123;input&#125;</h3>
            <div className={styles.form}>

              <div className={styles.exampleRow}>
                <span className={styles.pipeLabel}>load example:</span>
                {PIPE_EXAMPLES.map((ex, i) => (
                  <button key={i} className="btn small" onClick={() => loadPipeExample(i)}>{ex.label}</button>
                ))}
              </div>

              <div className={styles.pipeInputRow}>
                <label className={styles.pipeLabel}>initial input</label>
                <textarea
                  rows={3}
                  placeholder="The text or question to start the pipeline…"
                  value={pipeInput}
                  onChange={e => setPipeInput(e.target.value)}
                />
              </div>

              <div className={styles.pipeDivider}>▼ steps</div>

              {pipeSteps.map((step, i) => (
                <div key={i} className={styles.pipeStepCard}>
                  <div className={styles.pipeStepHeader}>
                    <span className={styles.stepNum}>step {i + 1}</span>
                    <select value={step.llm} onChange={e => setPipeStep(i, { llm: e.target.value })} style={{ minWidth: 160 }}>
                      <option value="">— select LLM —</option>
                      {allLlms.map(l => <option key={l.name} value={l.name}>{l.name} ({l.type})</option>)}
                    </select>
                    {pipeSteps.length > 1 && (
                      <button className="btn small red" onClick={() => setPipeSteps(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Prompt template — use {input} for previous output"
                    value={step.prompt_template}
                    onChange={e => setPipeStep(i, { prompt_template: e.target.value })}
                  />
                </div>
              ))}

              <div className={styles.controls}>
                <button className="btn" onClick={() => setPipeSteps(prev => [...prev, { prompt_template: '{input}', llm: allLlms[0]?.name ?? '' }])}>+ add step</button>
                <button className="btn green" onClick={runPipeline} disabled={pipeRunning}>
                  {pipeRunning ? 'running…' : '▶ run pipeline'}
                </button>
              </div>

              {pipeResults.length > 0 && (
                <div className={styles.results}>
                  {pipeResults.map((r) => (
                    <div key={r.step} className={styles.pipeResultCard}>
                      <div className={styles.cardHeader}>
                        <span>step {r.step + 1}</span>
                        <span>{r.llm}</span>
                        <span className={`${styles.badge} ${styles[r.status]}`}>{r.status}</span>
                        <span style={{ color: '#444', fontSize: '0.8rem' }}>id: {r.task_id}</span>
                      </div>
                      {r.prompt && (
                        <div className={styles.pipePromptBox}>
                          <span className={styles.pipePromptLabel}>prompt sent</span>
                          <div className={styles.pipePromptText}>{r.prompt}</div>
                        </div>
                      )}
                      {r.result && (
                        <>
                          <div className={styles.pipeArrow}>▼ output</div>
                          <div className={styles.result}>{r.result}</div>
                        </>
                      )}
                      {r.error && <div className={styles.error}>{r.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
