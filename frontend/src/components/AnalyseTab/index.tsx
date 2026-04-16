'use client'
import { useRef, useState } from 'react'
import { useAppState } from '@/contexts/AppState'
import styles from './AnalyseTab.module.css'

const BASE = '/api'

const EXAMPLE_PROMPTS = [
  'What is the highest temperature recorded in this data?',
  'What is the lowest temperature recorded in this data?',
  'What day had the most rainfall?',
  'Summarise the overall weather trend in 2-3 sentences.',
  'Are there any anomalies or unusual readings in this data?',
].join('\n')

const EXAMPLE_JSON = JSON.stringify({
  weather: [
    { date: '2024-01-01', temp_c: 3,  rainfall_mm: 2.1, condition: 'cloudy' },
    { date: '2024-01-02', temp_c: 7,  rainfall_mm: 0,   condition: 'sunny'  },
    { date: '2024-01-03', temp_c: 1,  rainfall_mm: 8.4, condition: 'rain'   },
    { date: '2024-01-04', temp_c: -2, rainfall_mm: 0,   condition: 'frost'  },
    { date: '2024-01-05', temp_c: 5,  rainfall_mm: 1.0, condition: 'cloudy' },
  ],
}, null, 2)

interface AnalyseResult {
  task_id: string
  prompt:  string
  llm:     string
  status:  'running' | 'done' | 'failed'
  result?: string
  error?:  string
}

export default function AnalyseTab() {
  const { llms }  = useAppState()
  const allLlms   = llms.filter(l => l.running || l.type === 'remote')

  const [jsonData,    setJsonData]    = useState('')
  const [promptsText, setPromptsText] = useState('')
  const [llmName,     setLlmName]     = useState('')
  const [results,     setResults]     = useState<AnalyseResult[]>([])
  const [running,     setRunning]     = useState(false)
  const [jsonError,   setJsonError]   = useState('')

  const jsonFileRef    = useRef<HTMLInputElement>(null)
  const promptFileRef  = useRef<HTMLInputElement>(null)

  function validateJson(text: string) {
    if (!text.trim()) { setJsonError(''); return }
    try { JSON.parse(text); setJsonError('') }
    catch (e: unknown) { setJsonError(e instanceof Error ? e.message : 'Invalid JSON') }
  }

  function handleJsonChange(text: string) {
    setJsonData(text)
    validateJson(text)
  }

  function loadJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      handleJsonChange(text)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function loadPromptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const raw    = ev.target?.result as string
      // strip markdown bullets and headings, keep non-empty lines as prompts
      const lines  = raw.split('\n')
        .map(l => l.replace(/^#+\s*/, '').replace(/^[-*+]\s+/, '').trim())
        .filter(Boolean)
      setPromptsText(lines.join('\n'))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function parsePrompts(): string[] {
    return promptsText.split('\n').map(l => l.trim()).filter(Boolean)
  }

  const charCount   = jsonData.length
  const tokenEst    = Math.round(charCount / 4)
  const tokenWarn   = tokenEst > 3000

  async function runAnalysis() {
    if (!jsonData.trim()) return
    const prompts = parsePrompts()
    if (!prompts.length || !llmName) return

    setRunning(true)
    setResults([])

    const resp = await fetch(`${BASE}/analyse/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        data:    jsonData,
        prompts: prompts.map(text => ({ text, llm_name: llmName })),
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
        setResults(prev => {
          const idx     = prev.findIndex(r => r.task_id === evt.task_id)
          const updated: AnalyseResult = {
            task_id: evt.task_id,
            prompt:  evt.prompt,
            llm:     evt.llm,
            status:  evt.status,
            result:  evt.result,
            error:   evt.error,
          }
          if (idx === -1) return [...prev, updated]
          const next = [...prev]; next[idx] = updated; return next
        })
      }
    }
    setRunning(false)
  }

  return (
    <div className={styles.container}>
      <h2>data analysis</h2>
      <div className={styles.subtitle}>
        <p>
          Paste or upload JSON data, then define a set of questions or prompts to run against it.
          All prompts are dispatched to Ray simultaneously and run concurrently — results stream back as each one finishes,
          so a fast prompt won&apos;t wait behind a slow one.
        </p>
        <p>
          Each prompt automatically receives the full data block as context.
          For best results keep the data concise — the token estimate below the data panel will warn you if it may exceed your model&apos;s context window.
        </p>
        <p style={{ color: '#444' }}>
          Backed by the same Ray remote tasks as the Ray tab. For concurrent prompts,
          llama.cpp with <code style={{ fontSize: '0.82rem' }}>--parallel N</code> or vllm are recommended backends.
        </p>
      </div>

      <div className={styles.panels}>

        {/* DATA panel */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>data (json)</span>
            <button className="btn small" onClick={() => jsonFileRef.current?.click()}>load file</button>
            <button className="btn small" onClick={() => { handleJsonChange(EXAMPLE_JSON) }}>load example</button>
            <input ref={jsonFileRef} type="file" accept=".json,.txt" style={{ display: 'none' }} onChange={loadJsonFile} />
          </div>
          <textarea
            className={styles.dataArea}
            placeholder="Paste JSON here or click load file…"
            value={jsonData}
            onChange={e => handleJsonChange(e.target.value)}
            spellCheck={false}
          />
          <div className={styles.dataFooter}>
            {jsonError
              ? <span className={styles.jsonError}>⚠ {jsonError}</span>
              : jsonData && <span className={styles.jsonOk}>✓ valid JSON</span>
            }
            {charCount > 0 && (
              <span className={tokenWarn ? styles.tokenWarn : styles.tokenOk}>
                ~{tokenEst.toLocaleString()} tokens{tokenWarn ? ' — may exceed local model context' : ''}
              </span>
            )}
          </div>
        </div>

        {/* PROMPTS panel */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>prompts</span>
            <button className="btn small" onClick={() => promptFileRef.current?.click()}>load .md file</button>
            <button className="btn small" onClick={() => setPromptsText(EXAMPLE_PROMPTS)}>load examples</button>
            <input ref={promptFileRef} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={loadPromptFile} />
          </div>
          <textarea
            className={styles.promptArea}
            placeholder={'One prompt per line, e.g.:\nWhat is the highest temperature?\nWhat day had the most rainfall?'}
            value={promptsText}
            onChange={e => setPromptsText(e.target.value)}
            spellCheck={false}
          />
          <div className={styles.promptFooter}>
            <span className={styles.promptCount}>{parsePrompts().length} prompt{parsePrompts().length !== 1 ? 's' : ''}</span>
          </div>
          <div className={styles.controls}>
            <select value={llmName} onChange={e => setLlmName(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">— select LLM —</option>
              {allLlms.map(l => <option key={l.name} value={l.name}>{l.name} ({l.type})</option>)}
            </select>
            <button
              className="btn green"
              onClick={runAnalysis}
              disabled={running || !jsonData.trim() || !parsePrompts().length || !llmName || !!jsonError}
            >
              {running ? 'running…' : '▶ run analysis'}
            </button>
          </div>
        </div>

        {/* OUTPUT panel */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>output</span>
            {results.length > 0 && (
              <span className={styles.resultCount}>
                {results.filter(r => r.status === 'done').length}/{results.length} done
              </span>
            )}
          </div>
          <div className={styles.outputArea}>
            {results.length === 0 && (
              <span className={styles.placeholder}>Results will appear here…</span>
            )}
            {results.map(r => (
              <div key={r.task_id} className={styles.resultCard}>
                <div className={styles.resultHeader}>
                  <span className={styles.resultPrompt}>{r.prompt}</span>
                  <span className={`${styles.badge} ${styles[r.status]}`}>{r.status}</span>
                </div>
                {r.result && <div className={styles.resultBody}>{r.result}</div>}
                {r.error  && <div className={styles.resultError}>{r.error}</div>}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
