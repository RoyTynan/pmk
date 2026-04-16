'use client'
import { useEffect, useState } from 'react'
import { useModal } from '@/components/Modal'
import { useAppState } from '@/contexts/AppState'
import { LLMType } from '@/lib/enums'
import styles from './SchedulerApi.module.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KernelOp {
  description?: string
  input_label?: string
  options?: Record<string, string>
}
interface MonitorRoute {
  path: string
  methods: string[]
  name: string
}

interface Task { id: string; prompt: string; status: string }

interface Props {
  scheduler:        string
  monitorPrefixes?: string[]
}

// ---------------------------------------------------------------------------
// OpenAPI helpers
// ---------------------------------------------------------------------------

function resolveRef(schema: unknown, root: Record<string, unknown>): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return null
  const s = schema as Record<string, unknown>
  if (s.$ref && typeof s.$ref === 'string') {
    const parts = s.$ref.replace('#/', '').split('/')
    let node: unknown = root
    for (const p of parts) node = (node as Record<string, unknown>)?.[p]
    return (node as Record<string, unknown>) ?? null
  }
  return s
}

/** Return the enum values for a dotted field path within a route's request body, or null. */
function getFieldEnum(
  openapi: Record<string, unknown> | null,
  routePath: string,
  method: string,
  fieldPath: string,
): string[] | null {
  if (!openapi) return null
  const paths   = openapi.paths as Record<string, unknown>
  const op      = (paths?.[routePath] as Record<string, unknown>)?.[method.toLowerCase()] as Record<string, unknown>
  const bodyRef = ((op?.requestBody as Record<string, unknown>)
    ?.content as Record<string, unknown>)
    ?.['application/json'] as Record<string, unknown>
  if (!bodyRef?.schema) return null

  let schema = resolveRef(bodyRef.schema, openapi)
  for (const part of fieldPath.split('.')) {
    if (!schema) return null
    const props = (schema.properties as Record<string, unknown>) ?? {}
    schema = resolveRef(props[part], openapi)
  }
  const enums = schema?.enum
  return Array.isArray(enums) ? (enums as string[]) : null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METHOD_COLOURS: Record<string, string> = {
  GET: styles.mGet, POST: styles.mPost, DELETE: styles.mDelete,
  PUT: styles.mPut, PATCH: styles.mPatch,
}

function Badge({ method }: { method: string }) {
  return <span className={`${styles.badge} ${METHOD_COLOURS[method] ?? styles.mOther}`}>{method}</span>
}

function extractPathParams(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1])
}

function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k] ?? ''))
}

function defaultBody(method: string, isKernel: boolean, path: string): Record<string, unknown> | null {
  if (['GET', 'DELETE'].includes(method)) return null
  if (isKernel)                           return { input: '', options: { llm: '' } }
  if (path.startsWith('/tasks')           && method === 'POST') return { prompt: '', agent_type: 'echo' }
  if (path === '/llms/register/local')    return { name: '', filename: '', port: 8080, max_tasks: 1, use_gpu: true }
  if (path === '/llms/register/remote')   return { name: '', url: '', model: '', provider: 'custom', max_tasks: 1 }
  if (path === '/llms/test')              return { name: '', url: '', model: '', provider: 'custom' }
  if (path === '/llms/{name}/start')      return null   // path param only, no body
  if (path === '/llms/{name}/stop')       return null   // path param only, no body
  if (path.startsWith('/llms')            && method === 'POST') return { name: '', model: '' }
  if (path === '/agentic/run')            return { prompt: '', llm_name: '', max: 3 }
  if (path === '/ray/run')               return { prompt: '', llm_name: '' }
  if (path === '/ray/batch')             return { tasks: [{ prompt: '', llm_name: '' }] }
  if (path === '/ray/pipeline')          return { initial_input: '', steps: [{ prompt_template: '', llm_name: '' }] }
  if (path === '/multi/pipeline/run')    return { steps: [{ name: '', prompt: '' }] }
  if (path === '/submit'                  && method === 'POST') return { prompt: '', agent_type: 'echo', target_llm: '', child_routing: 'same', aggregate: false }
  return null
}

const AGENT_TYPES = ['echo', 'planner']

// ---------------------------------------------------------------------------
// SmartForm
// ---------------------------------------------------------------------------

interface SmartFormProps {
  data:             Record<string, unknown>
  onChange:         (d: Record<string, unknown>) => void
  llmNames:         string[]
  runningLlmNames:  string[]
  modelFiles:       { name: string; type: string }[]
  openapi:          Record<string, unknown> | null
  routePath:        string
  method:           string
  inputLabel?:      string
  prefix?:          string
}

function SmartForm({ data, onChange, llmNames, runningLlmNames, modelFiles, openapi, routePath, method, inputLabel, prefix = '' }: SmartFormProps) {
  function set(key: string, value: unknown) { onChange({ ...data, [key]: value }) }

  return (
    <div className={styles.smartForm}>
      {Object.entries(data).map(([key, value]) => {
        const fieldPath = prefix ? `${prefix}.${key}` : key
        const label     = key === 'input' && inputLabel ? inputLabel : key

        // nested object → recurse
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return (
            <div key={fieldPath} className={styles.nestedBlock}>
              <span className={styles.nestedLabel}>{label}</span>
              <SmartForm
                data={value as Record<string, unknown>}
                onChange={nested => set(key, nested)}
                llmNames={llmNames} runningLlmNames={runningLlmNames}
                modelFiles={modelFiles} openapi={openapi}
                routePath={routePath} method={method} prefix={fieldPath}
              />
            </div>
          )
        }

        // llm / llm_name → only running LLMs (work is being routed to them)
        if (key === 'llm' || key === 'llm_name') {
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <select className={styles.fieldSelect} value={String(value)}
                      onChange={e => set(key, e.target.value)}>
                {key === 'llm' && <option value="">— default —</option>}
                {key === 'llm_name' && <option value="">— select LLM —</option>}
                {runningLlmNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )
        }

        // filename → local models only (LLMType.LOCAL from DB)
        if (key === 'filename') {
          const localFiles = modelFiles.filter(f => f.type === LLMType.LOCAL)
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <select className={styles.fieldSelect} value={String(value)}
                      onChange={e => set(key, e.target.value)}>
                <option value="">— select model —</option>
                {localFiles.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </div>
          )
        }

        // provider → known LLM providers
        if (key === 'provider') {
          const providers = ['custom', 'anthropic', 'openai', 'ollama']
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <select className={styles.fieldSelect} value={String(value)}
                      onChange={e => set(key, e.target.value)}>
                {providers.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )
        }

        // agent_type — check OpenAPI enum first, fall back to hardcoded
        if (key === 'agent_type') {
          const opts = getFieldEnum(openapi, routePath, method, fieldPath) ?? AGENT_TYPES
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <select className={styles.fieldSelect} value={String(value)}
                      onChange={e => set(key, e.target.value)}>
                {opts.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )
        }

        // any other field with an OpenAPI enum → select
        const oaEnum = getFieldEnum(openapi, routePath, method, fieldPath)
        if (oaEnum) {
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <select className={styles.fieldSelect} value={String(value)}
                      onChange={e => set(key, e.target.value)}>
                {oaEnum.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )
        }

        // numeric fields → number input
        if (typeof value === 'number') {
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <input className={styles.fieldInput} type="number" value={String(value)}
                     onChange={e => set(key, Number(e.target.value))} />
            </div>
          )
        }

        // boolean fields → select true/false
        if (typeof value === 'boolean') {
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <select className={styles.fieldSelect} value={String(value)}
                      onChange={e => set(key, e.target.value === 'true')}>
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </div>
          )
        }

        // prompt / input / prompt_template / initial_input → textarea
        if (key === 'prompt' || key === 'input' || key === 'prompt_template' || key === 'initial_input') {
          return (
            <div key={fieldPath} className={styles.field}>
              <label className={styles.fieldLabel}>{label}</label>
              <textarea className={styles.fieldTextarea} value={String(value)}
                        onChange={e => set(key, e.target.value)}
                        rows={3} spellCheck={false} />
            </div>
          )
        }

        // everything else → text input
        return (
          <div key={fieldPath} className={styles.field}>
            <label className={styles.fieldLabel}>{label}</label>
            <input className={styles.fieldInput} type="text" value={String(value)}
                   onChange={e => set(key, e.target.value)} />
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TestPanel
// ---------------------------------------------------------------------------

interface LLMObj { name: string; url: string; model: string; type: string; running?: boolean; provider?: string }

function TestPanel({
  method, url, path, isKernel, bodySchema, llmNames, modelFiles, llmObjects, inputLabel, openapi, paramOptions,
}: {
  method:        string
  url:           string
  path:          string
  isKernel:      boolean
  bodySchema:    Record<string, unknown> | null
  llmNames:      string[]
  modelFiles:    { name: string; type: string }[]
  llmObjects:    LLMObj[]
  inputLabel?:   string
  openapi:       Record<string, unknown> | null
  paramOptions:  Record<string, { value: string; label: string }[]>
}) {
  const pp              = extractPathParams(path)
  const runningLlmNames = llmObjects.filter(l => l.running).map(l => l.name)
  const [pVals,   setPVals]   = useState<Record<string, string>>({})
  const [form,    setForm]    = useState<Record<string, unknown>>(bodySchema ?? {})
  const [raw,     setRaw]     = useState(bodySchema ? JSON.stringify(bodySchema, null, 2) : '')
  const [mode,    setMode]    = useState<'form' | 'raw'>('form')
  const [sending, setSending] = useState(false)
  const [resp,    setResp]    = useState<{ status: number; ms: number; text: string } | { error: string } | null>(null)

  const modal   = useModal()
  const hasBody = bodySchema !== null

  function onFormChange(d: Record<string, unknown>) { setForm(d); setRaw(JSON.stringify(d, null, 2)) }
  function onRawChange(s: string) { setRaw(s); try { setForm(JSON.parse(s)) } catch {} }
  function switchToRaw()  { setRaw(JSON.stringify(form, null, 2)); setMode('raw') }
  function switchToForm() { try { setForm(JSON.parse(raw)) } catch {}; setMode('form') }

  async function send() {
    if (method === 'DELETE') {
      const target = fillPath(path, pVals)
      const confirmed = await modal.show(
        'Confirm delete',
        `Are you sure you want to delete:\n\n${target}`,
      )
      if (!confirmed) return
    }
    const finalUrl = fillPath(url, pVals)
    const t0 = Date.now()
    setSending(true); setResp(null)
    try {
      const bodyStr = hasBody ? (mode === 'form' ? JSON.stringify(form) : raw) : undefined
      const res = await fetch(finalUrl, {
        method,
        headers: hasBody ? { 'content-type': 'application/json' } : undefined,
        body:    bodyStr,
      })
      const ms = Date.now() - t0
      const text = await res.text()
      let pretty = text
      try { pretty = JSON.stringify(JSON.parse(text), null, 2) } catch {}
      setResp({ status: res.status, ms, text: pretty })
    } catch (e) {
      setResp({ error: String(e) })
    } finally { setSending(false) }
  }

  return (
    <div className={styles.testPanel}>
      {pp.length > 0 && (
        <div className={styles.paramRow}>
          {pp.map(p => {
            const opts = (() => {
              if (path === '/llms/{name}/start' && p === 'name')
                return llmObjects.filter(l => l.type === 'local' && !l.running).map(l => ({ value: l.name, label: l.name }))
              if (path === '/llms/{name}/stop' && p === 'name')
                return llmObjects.filter(l => l.running).map(l => ({ value: l.name, label: l.name }))
              return paramOptions[p]
            })()
            return (
              <label key={p} className={styles.paramLabel}>
                <span className={styles.paramName}>{p}</span>
                {opts ? (
                  <select className={styles.paramSelect}
                          value={pVals[p] ?? ''}
                          onChange={e => setPVals(v => ({ ...v, [p]: e.target.value }))}>
                    <option value="">— select —</option>
                    {opts.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input className={styles.paramInput} placeholder={p}
                         value={pVals[p] ?? ''}
                         onChange={e => setPVals(v => ({ ...v, [p]: e.target.value }))} />
                )}
              </label>
            )
          })}
        </div>
      )}

      {/* prefill from registry — shown for routes that mirror LLM registry fields */}
      {hasBody && (path === '/llms/test' || path === '/llms/register/remote') && (() => {
        const filteredLlms = llmObjects.filter(l =>
          path === '/llms/register/remote' ? l.type === 'remote' : true
        )
        if (!filteredLlms.length) return null
        return (
          <div className={styles.prefillRow}>
            <span className={styles.prefillLabel}>prefill from</span>
            <select className={styles.paramSelect} value=""
                    onChange={e => {
                      const llm = filteredLlms.find(l => l.name === e.target.value)
                      if (!llm) return
                      const next = { ...form,
                        name:     llm.name,
                        url:      llm.url,
                        model:    llm.model,
                        provider: llm.provider ?? 'custom',
                      }
                      setForm(next)
                      setRaw(JSON.stringify(next, null, 2))
                    }}>
              <option value="">— select registered LLM —</option>
              {filteredLlms.map(l => (
                <option key={l.name} value={l.name}>{l.name}</option>
              ))}
            </select>
          </div>
        )
      })()}

      {hasBody && (
        <div className={styles.bodyBlock}>
          <div className={styles.bodyHead}>
            <span className={styles.bodyLabel}>body</span>
            <div className={styles.modeToggle}>
              <button className={`${styles.modeBtn} ${mode === 'form' ? styles.modeBtnActive : ''}`}
                      onClick={switchToForm}>form</button>
              <button className={`${styles.modeBtn} ${mode === 'raw'  ? styles.modeBtnActive : ''}`}
                      onClick={switchToRaw}>raw</button>
            </div>
          </div>
          {mode === 'form' ? (
            <SmartForm
              data={form} onChange={onFormChange}
              llmNames={llmNames} runningLlmNames={runningLlmNames}
              modelFiles={modelFiles} openapi={openapi}
              routePath={path} method={method} inputLabel={inputLabel}
            />
          ) : (
            <textarea className={styles.bodyArea} value={raw}
                      onChange={e => onRawChange(e.target.value)}
                      spellCheck={false}
                      rows={Math.min(12, raw.split('\n').length + 1)} />
          )}
        </div>
      )}

      <div className={styles.sendRow}>
        <span className={styles.urlPreview}>{fillPath(url, pVals)}</span>
        <button className={styles.btnSend} onClick={send} disabled={sending}>
          {sending ? 'Sending…' : 'Send ▶'}
        </button>
      </div>

      {resp && (
        <div className={styles.respBox}>
          {'error' in resp ? (
            <span className={styles.respError}>{resp.error}</span>
          ) : (
            <>
              <div className={styles.respMeta}>
                <span className={resp.status < 300 ? styles.statusOk : styles.statusErr}>{resp.status}</span>
                <span className={styles.respMs}>{resp.ms}ms</span>
              </div>
              <pre className={styles.respBody}>{resp.text}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Route row
// ---------------------------------------------------------------------------

function RouteRow({
  method, path, label, url, isKernel, bodySchema, llmNames, modelFiles, llmObjects, inputLabel, openapi, paramOptions,
}: {
  method:        string
  path:          string
  label:         string
  url:           string
  isKernel:      boolean
  bodySchema:    Record<string, unknown> | null
  llmNames:      string[]
  modelFiles:    { name: string; type: string }[]
  llmObjects:    LLMObj[]
  inputLabel?:   string
  openapi:       Record<string, unknown> | null
  paramOptions:  Record<string, { value: string; label: string }[]>
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className={`${styles.routeRow} ${open ? styles.routeRowOpen : ''}`}
          onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <td className={styles.methodCell}><Badge method={method} /></td>
        <td className={styles.route}>{path}</td>
        <td className={styles.desc}>{label}</td>
        <td className={styles.chevron}>{open ? '▾' : '▸'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className={styles.panelCell}>
            <TestPanel
              method={method} url={url} path={path} isKernel={isKernel}
              bodySchema={bodySchema} llmNames={llmNames} modelFiles={modelFiles} llmObjects={llmObjects}
              inputLabel={inputLabel} openapi={openapi} paramOptions={paramOptions}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SchedulerApi({ scheduler, monitorPrefixes = [] }: Props) {
  const { llms: liveLlms, tasks: liveTasks } = useAppState()

  const [kernelOps,     setKernelOps]     = useState<Record<string, KernelOp> | null>(null)
  const [monitorRoutes, setMonitorRoutes] = useState<MonitorRoute[]>([])
  const [kernelPort,    setKernelPort]    = useState<number>(8002)
  const [modelFiles,    setModelFiles]    = useState<{ name: string; type: string }[]>([])
  const [openapi,       setOpenapi]       = useState<Record<string, unknown> | null>(null)
  const [loading,       setLoading]       = useState(false)

  // Derive live LLM lists directly from AppState (updated via WebSocket)
  const llmObjects = liveLlms as LLMObj[]
  const llmNames   = liveLlms.map(l => l.name)
  const paramOptions: Record<string, { value: string; label: string }[]> = {
    task_id: liveTasks.map(t => ({
      value: t.id,
      label: `${t.id.slice(0, 8)} — ${t.status} — ${(t.prompt ?? '').slice(0, 40)}`,
    })),
    name: liveLlms.map(l => ({ value: l.name, label: l.name })),
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/kernel/routes').then(r => r.ok ? r.json() : null),
      fetch('/api/routes').then(r => r.ok ? r.json() : []),
      fetch('/api/openapi.json').then(r => r.ok ? r.json() : null),
      fetch('/api/llms/models').then(r => r.ok ? r.json() : []),
    ]).then(([kData, mData, oaData, mfData]) => {
      if (kData) {
        setKernelOps(kData.schedulers?.[scheduler] ?? {})
        setKernelPort(kData.port ?? 8002)
      }
      const all: MonitorRoute[] = Array.isArray(mData) ? mData : []
      if (monitorPrefixes.length > 0) {
        setMonitorRoutes(all.filter(r => monitorPrefixes.some(p => r.path.startsWith(p))))
      }
      setModelFiles(Array.isArray(mfData) ? mfData : [])
      setOpenapi(oaData)
    }).finally(() => setLoading(false))
  }, [scheduler, monitorPrefixes.join(',')])

  if (loading) return <p className={styles.muted}>Loading…</p>

  const kernelEntries = Object.entries(kernelOps ?? {})

  return (
    <div className={styles.container}>

      {monitorRoutes.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Monitor API</span>
            <span className={styles.pill}>port 8000</span>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Method</th><th>Route</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {monitorRoutes.flatMap((r, i) =>
                r.methods.map(m => (
                  <RouteRow
                    key={`${i}:${m}`}
                    method={m} path={r.path}
                    label={r.name.replace(/_/g, ' ')}
                    url={`/api${r.path}`}
                    isKernel={false}
                    bodySchema={defaultBody(m, false, r.path)}
                    llmNames={llmNames} modelFiles={modelFiles} llmObjects={llmObjects} openapi={openapi} paramOptions={paramOptions}
                  />
                ))
              )}
            </tbody>
          </table>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Kernel API — {scheduler}</span>
          <span className={styles.pill}>port {kernelPort}</span>
        </div>
        {kernelEntries.length === 0 ? (
          <p className={styles.muted}>No kernel operations registered.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Method</th><th>Route</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {kernelEntries.map(([op, meta]) => (
                <RouteRow
                  key={op}
                  method="POST"
                  path={`/${scheduler}/${op}`}
                  label={meta.description ?? op}
                  url={`/api/kernel/proxy/${scheduler}/${op}`}
                  isKernel={true}
                  bodySchema={defaultBody('POST', true, `/${scheduler}/${op}`)}
                  llmNames={llmNames}
                  modelFiles={modelFiles}
                  llmObjects={llmObjects}
                  inputLabel={meta.input_label}
                  openapi={openapi}
                  paramOptions={paramOptions}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

    </div>
  )
}
