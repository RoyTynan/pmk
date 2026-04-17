'use client'
import { useState } from 'react'
import type { SchedulerInfo, SchedulerApiEntry } from '@/lib/api'
import styles from './SchedulerTab.module.css'

const METHOD_CLASS: Record<string, string> = {
  GET:    styles.mGet,
  POST:   styles.mPost,
  DELETE: styles.mDelete,
}

function ApiRow({ entry, schedulerName, disabled }: { entry: SchedulerApiEntry; schedulerName: string; disabled?: boolean }) {
  const [operation, setOperation] = useState('remove_alternate')
  const [inputText, setInputText] = useState('')
  const [optWord,   setOptWord]   = useState('')
  const [result,    setResult]    = useState<string | null>(null)
  const [busy,      setBusy]      = useState(false)
  const [idVal,     setIdVal]     = useState('')

  const hasId  = entry.path.includes('{id}')
  const isPost = entry.method === 'POST'
  const isGet  = entry.method === 'GET'

  const needsWord = operation === 'add_word' || operation === 'delete_word'

  async function run() {
    setBusy(true)
    setResult(null)
    try {
      if (isPost) {
        // Submit via the task queue so activity is logged and the task appears in the queue
        const agent_type = `${schedulerName}_${operation}`
        const options: Record<string, string> = {}
        if (needsWord && optWord) options.word = optWord
        const submitRes = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: inputText, agent_type, options: Object.keys(options).length ? options : undefined }),
        })
        const { task_id } = await submitRes.json()
        // Poll until done or failed (up to 15 s)
        let task: { status: string; result?: string | null; error?: string | null } | null = null
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 500))
          const res = await fetch(`/api/tasks/${task_id}`)
          task = await res.json()
          if (task && (task.status === 'done' || task.status === 'failed')) break
        }
        if (!task)                    { setResult('No response'); return }
        if (task.status === 'failed') { setResult(`error: ${task.error ?? 'task failed'}`); return }
        setResult(task.result ?? '(no result)')
      } else {
        const path = hasId ? entry.path.replace('{id}', idVal) : entry.path
        const res  = await fetch(`/api${path}`, { method: entry.method })
        const json = await res.json()
        setResult(JSON.stringify(json, null, 2))
      }
    } catch (e) {
      setResult(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.apiRow}>
      <div className={styles.apiHeader}>
        <span className={`${styles.method} ${METHOD_CLASS[entry.method] ?? ''}`}>{entry.method}</span>
        <code className={styles.path}>{entry.path}</code>
        <span className={styles.apiDesc}>{entry.description}</span>
      </div>

      {isPost && (
        <div className={styles.postForm}>
          <select className={styles.opSelect} value={operation} onChange={e => setOperation(e.target.value)}>
            <option value="remove_alternate">remove alternate words</option>
            <option value="add_word">add word</option>
            <option value="delete_word">delete word</option>
          </select>
          <textarea
            className={styles.textInput}
            placeholder="enter your text here…"
            rows={3}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
          />
          {needsWord && (
            <input
              className={styles.apiInput}
              placeholder={operation === 'add_word' ? 'word to add' : 'word to delete'}
              value={optWord}
              onChange={e => setOptWord(e.target.value)}
            />
          )}
          <button className="btn small green" onClick={run} disabled={busy || !inputText.trim() || disabled}>
            {busy ? '…' : 'send'}
          </button>
        </div>
      )}

      {!isPost && (
        <div className={styles.apiControls}>
          {hasId && (
            <input
              className={styles.apiInput}
              placeholder="id"
              style={{ width: 120 }}
              value={idVal}
              onChange={e => setIdVal(e.target.value)}
            />
          )}
          <button className="btn small" onClick={run} disabled={busy || disabled}>
            {busy ? '…' : isGet ? 'fetch' : 'run'}
          </button>
        </div>
      )}

      {result && (
        <pre className={styles.result}>{result}</pre>
      )}
    </div>
  )
}

export default function SchedulerTab({ info }: { info: SchedulerInfo }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{info.label.toLowerCase()} scheduler</h2>
          {!info.registered && (
            <span className={styles.unregBadge}>unregistered</span>
          )}
        </div>
        <span className={styles.desc}>{info.description}</span>
        {!info.registered && (
          <p className={styles.unregNote}>
            This scheduler is not registered — its task queue is inactive.
            Re-register it from the assistant tab, then restart the host to resume.
          </p>
        )}
      </div>

      <div className={styles.sectionLabel}>api</div>
      <div className={styles.apiList}>
        {info.api.map(e => <ApiRow key={`${e.method}${e.path}`} entry={e} schedulerName={info.name} disabled={!info.registered} />)}
      </div>
    </div>
  )
}
