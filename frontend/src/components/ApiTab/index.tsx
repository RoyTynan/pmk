'use client'
import { useEffect, useState, useCallback } from 'react'
import styles from './ApiTab.module.css'

interface MonitorRoute {
  path: string
  methods: string[]
  name: string
}

interface KernelOp {
  description?: string
  input_label?: string
  options?: Record<string, string>
}

interface KernelScheduler {
  [op: string]: KernelOp
}

interface KernelRoutes {
  schedulers: Record<string, KernelScheduler>
  port?: number
  available?: boolean
}

const METHOD_CLASS: Record<string, string> = {
  GET:    styles.mGet,
  POST:   styles.mPost,
  PUT:    styles.mPut,
  PATCH:  styles.mPatch,
  DELETE: styles.mDelete,
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span className={`${styles.methodBadge} ${METHOD_CLASS[method] ?? styles.mOther}`}>
      {method}
    </span>
  )
}

export default function ApiTab() {
  const [monitorRoutes, setMonitorRoutes]   = useState<MonitorRoute[] | null>(null)
  const [hostRoutes,  setKernelRoutes]    = useState<KernelRoutes  | null>(null)
  const [loading,       setLoading]         = useState(false)
  const [error,         setError]           = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mRes, kRes] = await Promise.all([
        fetch('/api/routes'),
        fetch('/api/host/routes'),
      ])
      setMonitorRoutes(mRes.ok ? await mRes.json() : [])
      setKernelRoutes(kRes.ok  ? await kRes.json() : { schedulers: {}, available: false })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const hostUp = hostRoutes?.available !== false && hostRoutes && Object.keys(hostRoutes.schedulers ?? {}).length > 0

  return (
    <div className={styles.container}>

      {/* ── Monitor API ─────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Monitor API</span>
          <span className={styles.pill}>port 8000</span>
          <button className={styles.btnRefresh} onClick={load} disabled={loading}>
            {loading ? '…' : '↺'}
          </button>
        </div>
        <p className={styles.sectionNote}>
          Control-plane endpoints — task queue, LLM registry, WebSocket feed.
        </p>
        {error && <p className={styles.errorMsg}>{error}</p>}
        {monitorRoutes === null ? (
          <p className={styles.empty}>Loading…</p>
        ) : monitorRoutes.length === 0 ? (
          <p className={styles.empty}>No routes found.</p>
        ) : (
          <table className={styles.routeTable}>
            <tbody>
              {monitorRoutes.map((r, i) => (
                <tr key={i}>
                  <td className={styles.methodCell}>
                    {r.methods.map(m => <MethodBadge key={m} method={m} />)}
                  </td>
                  <td className={styles.pathCell}>{r.path}</td>
                  <td className={styles.nameCell}>{r.name.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Kernel API ──────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Kernel API</span>
          <span className={styles.pill}>port {hostRoutes?.port ?? 8002}</span>
          {!hostUp && hostRoutes !== null && (
            <span className={styles.pillWarn}>host offline</span>
          )}
        </div>
        <p className={styles.sectionNote}>
          Execution-plane endpoints — auto-generated from scheduler handler registries.
        </p>
        {hostRoutes === null ? (
          <p className={styles.empty}>Loading…</p>
        ) : !hostUp ? (
          <p className={styles.empty}>Kernel HTTP server not reachable.</p>
        ) : (
          Object.entries(hostRoutes.schedulers).map(([schedName, ops]) => (
            <div key={schedName} className={styles.schedulerBlock}>
              <div className={styles.schedulerName}>{schedName}</div>
              <table className={styles.routeTable}>
                <tbody>
                  {Object.entries(ops).map(([opName, meta]) => (
                    <tr key={opName}>
                      <td className={styles.methodCell}>
                        <MethodBadge method="POST" />
                      </td>
                      <td className={styles.pathCell}>/{schedName}/{opName}</td>
                      <td className={styles.nameCell}>{meta.description ?? opName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>

    </div>
  )
}
