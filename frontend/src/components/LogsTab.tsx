'use client'
import { useEffect, useRef, useState } from 'react'
import { api, type LLM } from '@/lib/api'
import { useModal } from './Modal'
import styles from './LogsTab.module.css'

export default function LogsTab() {
  const modal = useModal()
  const [localLlms, setLocalLlms] = useState<LLM[]>([])
  const [selected, setSelected]   = useState('')
  const [lines, setLines]         = useState('50')
  const [output, setOutput]       = useState('select an LLM to view its log')
  const [updated, setUpdated]     = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const outRef  = useRef<HTMLDivElement>(null)

  async function loadLlms() {
    const all = await api.llms()
    const local = all.filter(l => l.type === 'local')
    setLocalLlms(local)
    if (local.length && !selected) setSelected(local[0].name)
  }

  async function refreshLog(name = selected, n = lines) {
    if (!name) return
    const data = await api.llmLog(name, parseInt(n))
    if (!data.exists) { setOutput('no log file found — start the LLM server to generate logs'); return }
    setOutput(data.lines.join(''))
    setUpdated('updated ' + new Date().toLocaleTimeString())
    setTimeout(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight }, 0)
  }

  useEffect(() => {
    loadLlms()
    pollRef.current = setInterval(() => refreshLog(), 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => { if (selected) refreshLog() }, [selected, lines])

  async function clearLog() {
    if (!selected) return
    if (!await modal.show('clear log', `Clear the log file for "${selected}"?`)) return
    await api.llmLogClear(selected)
    setOutput('log cleared')
    setUpdated('cleared ' + new Date().toLocaleTimeString())
  }

  function renderLog(raw: string) {
    return raw.split('\n').map((line, i) => {
      const isTok = line.includes('tokens per second') || line.includes('tok/s') || line.includes('t/s')
      return isTok
        ? <span key={i} className={styles.tok}>{line}{'\n'}</span>
        : <span key={i}>{line}{'\n'}</span>
    })
  }

  return (
    <div>
      <div className={styles.controls}>
        <select value={selected} onChange={e => setSelected(e.target.value)}>
          {localLlms.length
            ? localLlms.map(l => <option key={l.name} value={l.name}>{l.name}</option>)
            : <option value="">no local LLMs</option>}
        </select>
        <select value={lines} onChange={e => setLines(e.target.value)}>
          <option value="50">last 50 lines</option>
          <option value="100">last 100 lines</option>
          <option value="200">last 200 lines</option>
        </select>
        <button className="btn" onClick={() => refreshLog()}>refresh</button>
        <button className="btn red" onClick={clearLog}>clear log</button>
        <span className={styles.updated}>{updated}</span>
      </div>
      <div ref={outRef} className={styles.output}>
        {renderLog(output)}
      </div>
    </div>
  )
}
