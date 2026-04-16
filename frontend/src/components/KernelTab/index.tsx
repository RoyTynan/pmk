'use client'
import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppState } from '@/contexts/AppState'
import styles from './KernelTab.module.css'

interface KernelOp {
  description?: string
  input_label?: string
}
interface KernelRoutes {
  schedulers: Record<string, Record<string, KernelOp>>
  port?: number
  available?: boolean
}

export default function KernelTab() {
  const { kernel, tasks, activity } = useAppState()
  const kernelUp = kernel.running

  const [kernelRoutes, setKernelRoutes] = useState<KernelRoutes | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [acting,       setActing]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const kr = await fetch('/api/kernel/routes')
      setKernelRoutes(kr.ok ? await kr.json() : { schedulers: {}, available: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function startKernel() {
    setActing(true)
    await fetch('/api/kernel/start', { method: 'POST' })
    // give it a moment to boot before re-checking
    await new Promise(r => setTimeout(r, 1500))
    await load()
    setActing(false)
  }

  async function stopKernel() {
    setActing(true)
    await fetch('/api/kernel/stop', { method: 'POST' })
    await load()
    setActing(false)
  }

  const [openPanel,   setOpenPanel]   = useState<string | null>(null)
  const [taskPage,    setTaskPage]    = useState(0)
  const [actPage,     setActPage]     = useState(0)
  const [taskActing,  setTaskActing]  = useState<string | null>(null)  // task id being acted on
  const [clearing,    setClearing]    = useState(false)
  const [clearWarn,   setClearWarn]   = useState(false)
  const [panelClearWarn, setPanelClearWarn] = useState(false)
  const [panelClearing,  setPanelClearing]  = useState(false)
  const [actClearing,    setActClearing]    = useState(false)
  const [actClearWarn,   setActClearWarn]   = useState(false)
  const [mounted,     setMounted]     = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const PAGE_SIZE = 10

  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})

  function togglePanel(status: string) {
    setOpenPanel(p => p === status ? null : status)
    setPanelClearWarn(false)
    setTaskPage(0)
  }

  const panelTasks    = openPanel ? tasks.filter(t => t.status === openPanel) : []
  const totalPages    = Math.ceil(panelTasks.length / PAGE_SIZE)
  const pagedTasks    = panelTasks.slice(taskPage * PAGE_SIZE, (taskPage + 1) * PAGE_SIZE)

  const schedulerCount = Object.keys(kernelRoutes?.schedulers ?? {}).length

  return (
    <div className={styles.container}>

      {/* ── Status + controls ──────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Kernel</span>
          <button className={styles.btnRefresh} onClick={load} disabled={loading || acting}>
            {loading ? '…' : '↺'}
          </button>
        </div>
        <table className={styles.propTable}>
          <tbody>
            <tr>
              <td>Status</td>
              <td>
                <span className={kernelUp ? styles.statusUp : styles.statusDown}>
                  {kernelUp ? 'running' : 'offline'}
                </span>
              </td>
            </tr>
            <tr><td>API port</td><td>{kernelRoutes?.port ?? 8002}</td></tr>
            <tr><td>Schedulers</td><td>{schedulerCount > 0 ? Object.keys(kernelRoutes!.schedulers).join(', ') : '—'}</td></tr>
          </tbody>
        </table>
        <div className={styles.controls}>
          <button
            className={styles.btnStart}
            onClick={startKernel}
            disabled={acting || kernelUp}
          >
            {acting && !kernelUp ? 'Starting…' : 'Start'}
          </button>
          <button
            className={styles.btnStop}
            onClick={stopKernel}
            disabled={acting || !kernelUp}
          >
            {acting && kernelUp ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      </section>

      {/* ── Queue stats ─────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Task Queue</span>
          <button
            className={`${styles.btnClear} ${clearWarn ? styles.btnClearWarn : ''}`}
            disabled={!mounted || clearing || ((counts['done'] ?? 0) + (counts['failed'] ?? 0)) === 0}
            onClick={async () => {
              if (!clearWarn) { setClearWarn(true); return }
              setClearWarn(false)
              setClearing(true)
              await api.tasksClearCompleted()
              setClearing(false)
              if (openPanel === 'done' || openPanel === 'failed') setOpenPanel(null)
            }}
            onBlur={() => setClearWarn(false)}
            title="Remove all done and failed tasks"
          >
            {clearing ? '…' : clearWarn ? 'confirm clear?' : 'clear completed'}
          </button>
        </div>
        <div className={styles.statRow}>
          {['pending', 'running', 'done', 'failed'].map(s => (
            <div
              key={s}
              className={`${styles.stat} ${styles[`s_${s}`]} ${openPanel === s ? styles.statActive : ''}`}
              onClick={() => togglePanel(s)}
              title={`${counts[s] ?? 0} ${s} — click to ${openPanel === s ? 'close' : 'view'}`}
            >
              <span className={styles.statNum}>{counts[s] ?? 0}</span>
              <span className={styles.statLabel}>{s}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Task panel ──────────────────────────────────────────── */}
      {openPanel && (
        <section className={`${styles.card} ${styles.wide} ${styles.taskPanel}`}>
          <div className={styles.cardHead}>
            <span className={`${styles.cardTitle} ${styles[`s_${openPanel}`]}`}>{openPanel} tasks</span>
            <span className={styles.taskCount}>{panelTasks.length}</span>
            <button
              className={`${styles.btnClear} ${panelClearWarn ? styles.btnClearWarn : ''}`}
              disabled={panelClearing || panelTasks.length === 0}
              onClick={async () => {
                if (!panelClearWarn) { setPanelClearWarn(true); return }
                setPanelClearWarn(false)
                setPanelClearing(true)
                await api.tasksClearStatus(openPanel!)
                setPanelClearing(false)
              }}
              onBlur={() => setPanelClearWarn(false)}
            >
              {panelClearing ? '…' : panelClearWarn ? 'confirm?' : `clear ${openPanel}`}
            </button>
            <button className={styles.btnRefresh} onClick={() => setOpenPanel(null)}>✕</button>
          </div>
          {panelTasks.length === 0 ? (
            <div className={styles.taskEmpty}>no {openPanel} tasks</div>
          ) : (
            <>
              <table className={styles.taskTable}>
                <thead>
                  <tr>
                    <th>time</th>
                    <th>id</th>
                    <th>type</th>
                    <th>prompt</th>
                    {openPanel === 'done'   && <th>result</th>}
                    {openPanel === 'failed' && <th>llm</th>}
                    {openPanel === 'failed' && <th>error</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTasks.map(t => {
                    const acting = taskActing === t.id
                    async function doRequeue() {
                      setTaskActing(t.id)
                      await api.taskRequeue(t.id)
                      setTaskActing(null)
                    }
                    async function doDelete() {
                      setTaskActing(t.id)
                      await api.taskDelete(t.id)
                      setTaskActing(null)
                    }
                    return (
                      <tr key={t.id}>
                        <td className={styles.taskTime}>{t.created_at ? new Date(t.created_at * 1000).toLocaleTimeString() : '—'}</td>
                        <td className={styles.taskId}>{t.id.slice(0, 8)}</td>
                        <td className={styles.taskType}>{t.agent_type ?? '—'}</td>
                        <td className={styles.taskPrompt}>{t.prompt}</td>
                        {openPanel === 'done'   && <td className={styles.taskResult}>{String(t.result ?? '').slice(0, 120)}</td>}
                        {openPanel === 'failed' && <td className={styles.taskLlm}>{t.llm ?? t.target_llm ?? '—'}</td>}
                        {openPanel === 'failed' && <td className={styles.taskError}>{t.error ?? '—'}</td>}
                        <td className={styles.taskActions}>
                          {openPanel !== 'running' && (
                            <button className={styles.btnRequeue} onClick={doRequeue} disabled={acting} data-tip="requeue">
                              {acting ? '…' : '↺'}
                            </button>
                          )}
                          <button className={styles.btnDel} onClick={doDelete} disabled={acting} data-tip="delete">
                            {acting ? '…' : '✕'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button className={styles.pageBtn} onClick={() => setTaskPage(p => p - 1)} disabled={taskPage === 0}>‹</button>
                  <span className={styles.pageInfo}>page {taskPage + 1} / {totalPages}</span>
                  <button className={styles.pageBtn} onClick={() => setTaskPage(p => p + 1)} disabled={taskPage >= totalPages - 1}>›</button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Kernel Activity log ─────────────────────────────────── */}
      {(() => {
        const actTotalPages = Math.ceil(activity.length / PAGE_SIZE)
        const safeActPage   = Math.min(actPage, Math.max(0, actTotalPages - 1))
        const pagedActivity = activity.slice(safeActPage * PAGE_SIZE, (safeActPage + 1) * PAGE_SIZE)
        return (
          <section className={`${styles.card} ${styles.wide}`}>
            <div className={styles.cardHead}>
              <span className={styles.cardTitle}>Kernel Activity</span>
              <span className={styles.taskCount}>{activity.length}</span>
              <button
                className={`${styles.btnClear} ${actClearWarn ? styles.btnClearWarn : ''}`}
                disabled={!mounted || actClearing || activity.length === 0}
                onClick={async () => {
                  if (!actClearWarn) { setActClearWarn(true); return }
                  setActClearWarn(false)
                  setActClearing(true)
                  await api.activityClear()
                  setActPage(0)
                  setActClearing(false)
                }}
                onBlur={() => setActClearWarn(false)}
              >
                {actClearing ? '…' : actClearWarn ? 'confirm clear?' : 'clear'}
              </button>
            </div>
            {activity.length === 0 ? (
              <div className={styles.taskEmpty}>no activity recorded</div>
            ) : (
              <>
                <table className={styles.actTable}>
                  <thead>
                    <tr>
                      <th>time</th>
                      <th>handler</th>
                      <th>source</th>
                      <th>model</th>
                      <th>dur ms</th>
                      <th>prompt</th>
                      <th>result</th>
                      <th>ok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedActivity.map(a => (
                      <tr key={a.id} className={a.ok === 0 ? styles.actRowErr : ''}>
                        <td className={styles.actTime}>{new Date(a.ts * 1000).toLocaleTimeString()}</td>
                        <td className={styles.actLlm}>{a.llm}</td>
                        <td className={styles.actSource}>{a.source}</td>
                        <td className={styles.actModel}>{a.model ?? '—'}</td>
                        <td className={styles.actDur}>{a.duration_ms ?? '—'}</td>
                        <td className={styles.actLen}>{a.prompt_len ?? '—'}</td>
                        <td className={styles.actLen}>{a.result_len ?? '—'}</td>
                        <td className={a.ok === 1 ? styles.actOk : styles.actFail}>
                          {a.ok === 1 ? '✓' : '✗'}
                          {a.error ? <span className={styles.actErrTip} title={a.error}> !</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {actTotalPages > 1 && (
                  <div className={styles.pagination}>
                    <button className={styles.pageBtn} onClick={() => setActPage(p => p - 1)} disabled={safeActPage === 0}>‹</button>
                    <span className={styles.pageInfo}>page {safeActPage + 1} / {actTotalPages}</span>
                    <button className={styles.pageBtn} onClick={() => setActPage(p => p + 1)} disabled={safeActPage >= actTotalPages - 1}>›</button>
                  </div>
                )}
              </>
            )}
          </section>
        )
      })()}

      {/* ── Loaded schedulers ───────────────────────────────────── */}
      {schedulerCount > 0 && (
        <section className={`${styles.card} ${styles.wide}`}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>Loaded Schedulers</span>
          </div>
          {Object.entries(kernelRoutes!.schedulers).map(([name, ops]) => (
            <div key={name} className={styles.schedBlock}>
              <div className={styles.schedName}>{name}</div>
              <table className={styles.opTable}>
                <tbody>
                  {Object.entries(ops).map(([op, meta]) => (
                    <tr key={op}>
                      <td className={styles.opRoute}>POST /{name}/{op}</td>
                      <td className={styles.opDesc}>{meta.description ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

    </div>
  )
}
