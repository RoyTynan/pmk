'use client'
import { useEffect, useState } from 'react'
import { api, type Agent } from '@/lib/api'
import { useAppState } from '@/contexts/AppState'
import styles from './MonitorTab.module.css'

const PAGE_SIZE = 10

function buildTree(tasks: ReturnType<typeof useAppState>['tasks']) {
  const byId: Record<string, typeof tasks[0]> = {}
  const children: Record<string, typeof tasks> = {}
  tasks.forEach(t => { byId[t.id] = t; children[t.id] = [] })
  const roots: typeof tasks = []
  tasks.forEach(t => {
    if (t.parent_id && byId[t.parent_id]) children[t.parent_id].push(t)
    else roots.push(t)
  })
  const flat: { task: typeof tasks[0]; depth: number }[] = []
  roots.forEach(r => {
    flat.push({ task: r, depth: 0 })
    ;(children[r.id] || [])
      .sort((a, b) => a.created_at - b.created_at)
      .forEach(c => flat.push({ task: c, depth: 1 }))
  })
  return flat
}

function fmt(ts: number | null) {
  return ts ? new Date(ts * 1000).toLocaleTimeString() : '—'
}

export default function MonitorTab() {
  const { tasks, llms, host } = useAppState()
  const [agents, setAgents]       = useState<Agent[]>([])
  const [page, setPage]           = useState(0)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const [prompt, setPrompt]       = useState('')
  const [agent, setAgent]         = useState('echo')
  const [llm, setLlm]             = useState('')
  const [routing, setRouting]     = useState('same')
  const [aggregate, setAggregate] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')

  useEffect(() => {
    api.agents().then(a => { setAgents(a); if (a.length) setAgent(a[0].name) })
  }, [])

  // set default LLM once list arrives
  useEffect(() => {
    if (!llm && llms.length) setLlm(llms[0].name)
  }, [llms])

  async function submitTask() {
    if (!prompt.trim()) return
    if (!host.running) { setSubmitMsg('⚠ host is not running — start it first'); return }
    const selectedLlm = llms.find(l => l.name === llm)
    if (selectedLlm?.type === 'local' && !selectedLlm.running) { setSubmitMsg(`⚠ "${llm}" is not running — start it in the LLMs tab first`); return }
    const isPlanner = agent === 'planner'
    await api.submit({
      prompt: prompt.trim(),
      target_llm: llm,
      agent_type: agent,
      child_routing: isPlanner ? routing : 'same',
      aggregate: isPlanner && aggregate,
    })
    setSubmitMsg('submitted')
    setPrompt('')
    setTimeout(() => setSubmitMsg(''), 3000)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const flat       = buildTree(tasks)
  const totalPages = Math.max(1, Math.ceil(flat.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages - 1)
  const pageRows   = flat.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div>
      {!host.running && (
        <div style={{ background: '#2a1a00', border: '1px solid #fa0', borderRadius: 4, padding: '0.4rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.9rem', color: '#fa0' }}>
          ⚠ host is stopped — click <strong>host ○ stopped</strong> in the top bar to start it before submitting tasks
        </div>
      )}

      {/* submit panel */}
      <div className={styles.submitPanel}>
        <h2>submit task <span style={{ fontSize: '0.8rem', color: '#555', fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>— click an example below or type your own</span></h2>
        <div className={styles.examplePrompts}>
          {[
            'What is the capital of France?',
            'Explain what a neural network is in simple terms.',
            'Write a short poem about the ocean.',
            'What are three benefits of exercise?',
            'Summarise the history of the internet in two sentences.',
          ].map(p => (
            <button key={p} className={styles.examplePrompt} onClick={() => setPrompt(p)}>{p}</button>
          ))}
        </div>
        <textarea
          rows={3}
          placeholder="enter prompt… (Ctrl+Enter to submit)"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submitTask() }}
        />
        <div className="row">
          <select value={llm} onChange={e => setLlm(e.target.value)}>
            {llms.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          <select value={agent} onChange={e => setAgent(e.target.value)}>
            {agents.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
          <button className="btn blue" onClick={submitTask}>submit</button>
          {submitMsg && <span className={styles.submitMsg} style={submitMsg.startsWith('⚠') ? { color: '#fa0' } : {}}>{submitMsg}</span>}
        </div>
        {agent === 'planner' && (
          <div className="row">
            <select value={routing} onChange={e => setRouting(e.target.value)}>
              <option value="same">same model</option>
              <option value="split">split across models</option>
            </select>
            <label className={styles.toggle}>
              <input type="checkbox" checked={aggregate} onChange={e => setAggregate(e.target.checked)} />
              aggregate results
            </label>
            <span className={styles.hint}>(waits for subtasks, then synthesises a final answer)</span>
          </div>
        )}
      </div>

      {/* task table */}
      <div>
        <h2>tasks</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th><th>STATUS</th><th>AGENT</th><th>LLM</th>
                <th>STARTED</th><th>FINISHED</th><th>IN ~TKN</th><th>OUT TKN</th>
                <th>PRI</th><th>PROMPT</th><th>RESULT</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ task: t, depth }) => (
                <tr key={t.id} className={depth > 0 ? styles.childRow : ''}>
                  <td>{depth > 0 && <span className={styles.tree}>└ </span>}{t.id.slice(0, 8)}</td>
                  <td className={styles[t.status]}>{t.status}</td>
                  <td>{t.agent_type}</td>
                  <td>{t.llm || t.target_llm || '—'}</td>
                  <td>{fmt(t.started_at)}</td>
                  <td>{fmt(t.finished_at)}</td>
                  <td>{t.input_tokens_est ? `~${t.input_tokens_est}` : '—'}</td>
                  <td>{t.token_budget || '—'}</td>
                  <td>{t.priority}</td>
                  <td className={`${styles.wide} ${depth > 0 ? styles.childPrompt : ''}`}>
                    {(t.prompt || '').slice(0, 60)}
                  </td>
                  <td
                    className={`${styles.wide} ${styles.resultCell} ${expanded.has(t.id) ? styles.expanded : ''}`}
                    onClick={() => toggleExpand(t.id)}
                  >
                    {t.result || t.error || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>← prev</button>
          <span>page {safePage + 1} of {totalPages} ({tasks.length} tasks)</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}>next →</button>
        </div>
      </div>
    </div>
  )
}
