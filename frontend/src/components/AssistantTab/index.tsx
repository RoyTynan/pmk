'use client'
import { useState } from 'react'
import { api, type SchedulerInfo } from '@/lib/api'
import styles from './AssistantTab.module.css'

function makePrompts(name: string, folder: string) {
  const base = `server/schedulers/${folder}`
  const rule  = `\n\n⚠ Work only inside \`${base}/\`. Do NOT open, read, or modify anything in \`server/kernelroot/\` — that directory is off-limits.`
  return [
    {
      label: 'Add a handler',
      text:
        `Add a new handler class to \`${base}/handlers/\`. The class should extend \`${name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).replace(/ /,'')}HandlerBase\` from \`${base}/handlers/base.py\`, implement a \`handle(self, input: str, options: dict | None) -> str\` method that returns a JSON string, and be registered in \`HANDLER_REGISTRY\` inside \`${base}/scheduler.py\` and \`_HANDLERS\` inside \`${base}/router.py\`.` + rule,
    },
    {
      label: 'Extend the database',
      text:
        `Add a new column to the \`results\` table in \`${base}/db.py\`. Update \`save_result()\` to accept and store the new value, and update \`list_results()\` to return it. All changes must stay inside \`${base}/\`.` + rule,
    },
    {
      label: 'Add an API route',
      text:
        `Add a new route to \`${base}/router.py\`. Use the existing \`router\` (APIRouter) object — do not create a new one. Keep all changes inside \`${base}/\`.` + rule,
    },
    {
      label: 'Custom scheduler logic',
      text:
        `Modify the \`run()\` or \`_run_task()\` method in \`${base}/scheduler.py\` to implement custom scheduling behaviour. The class already calls \`super().__init__()\` and uses \`self._stop_event\` / \`self._sleep()\` — preserve those. Stay inside \`${base}/\`.` + rule,
    },
  ]
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button className={`btn ${copied ? 'green' : ''} ${styles.copyBtn}`} onClick={copy}>
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

export default function AssistantTab({ onCreated, schedulers }: { onCreated: () => void; schedulers: SchedulerInfo[] }) {
  const [name,         setName]         = useState('')
  const [busy,         setBusy]         = useState(false)
  const [report,       setReport]       = useState<null | { ok: boolean; folder?: string; created?: string[]; error?: string }>(null)
  const [promptTarget, setPromptTarget] = useState<string>('')   // scheduler name to show prompts for
  const [delTarget,    setDelTarget]    = useState('')
  const [unregBusy,    setUnregBusy]    = useState(false)
  const [unregResult,  setUnregResult]  = useState<null | { ok: boolean; unregistered?: string; scheduler_stopped?: boolean; error?: string }>(null)
  const [regBusy,      setRegBusy]      = useState(false)
  const [regResult,    setRegResult]    = useState<null | { ok: boolean; registered?: string; scheduler_started?: boolean; error?: string }>(null)
  const [deleteStep,   setDeleteStep]   = useState(0)
  const [delBusy,      setDelBusy]      = useState(false)
  const [delResult,    setDelResult]    = useState<null | { ok: boolean; deleted?: string; error?: string }>(null)

  const userSchedulers = schedulers.filter(s => !s.builtin)

  const slug       = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
  const folderName = slug ? `${slug}_scheduler` : ''
  const preview    = slug ? `schedulers/${folderName}/` : ''

  async function create() {
    if (!slug) return
    setBusy(true)
    setReport(null)
    const res = await api.assistantCreate(slug)
    setReport(res)
    setBusy(false)
    if (res.ok) { onCreated(); setPromptTarget(slug) }
  }

  async function stopAndRegister() {
    await api.kernelStop()
    setTimeout(() => api.kernelStart(), 800)
  }

  function clearDelResults() { setUnregResult(null); setRegResult(null); setDelResult(null); setDeleteStep(0) }

  async function unregisterScheduler() {
    if (!delTarget) return
    setUnregBusy(true)
    clearDelResults()
    const res = await api.assistantUnregister(delTarget)
    setUnregResult(res)
    setUnregBusy(false)
    if (res.ok) onCreated()
  }

  async function reregisterScheduler() {
    if (!delTarget) return
    setRegBusy(true)
    clearDelResults()
    const res = await api.assistantRegister(delTarget)
    setRegResult(res)
    setRegBusy(false)
    if (res.ok) onCreated()
  }

  async function deleteScheduler() {
    if (!delTarget) return
    if (deleteStep < 2) { setDeleteStep(s => s + 1); return }
    setDelBusy(true)
    setDeleteStep(0)
    const res = await api.assistantDelete(delTarget)
    setDelResult(res)
    setDelBusy(false)
    if (res.ok) { onCreated(); setDelTarget('') }
  }

  const activeTarget  = promptTarget || (userSchedulers[0]?.name ?? '')
  const targetFolder  = activeTarget ? `${activeTarget}_scheduler` : ''
  const targetPrompts = activeTarget ? makePrompts(activeTarget, targetFolder) : []

  const promptsPanel = userSchedulers.length > 0 ? (
    <div className={styles.promptsPanel}>
      <div className={styles.promptsPanelHeader}>
        <span className={styles.sectionLabel}>AI assistant (claude code) style prompts</span>
        <select
          className={styles.promptPicker}
          value={activeTarget}
          onChange={e => setPromptTarget(e.target.value)}
        >
          {userSchedulers.map(s => (
            <option key={s.name} value={s.name}>{s.name}_scheduler</option>
          ))}
        </select>
      </div>

      {report?.ok && promptTarget && promptTarget === report.folder?.replace('schedulers/', '').replace(/_scheduler$/, '') && (
        <div className={styles.section}>
          <div className={styles.reportHeader}>
            <span className={styles.badge}>created</span>
            <code>{report.folder}</code>
          </div>
          <div className={styles.sectionLabel} style={{ marginBottom: '0.4rem' }}>files generated</div>
          <ul className={styles.fileList} style={{ marginBottom: '0.8rem' }}>
            {report.created?.map(f => <li key={f}><code>{f}</code></li>)}
          </ul>
          <button className="btn amber" onClick={stopAndRegister}>stop kernel &amp; register</button>
        </div>
      )}

      <div className={styles.kernelRuleNotice}>
        It is so important that you include in your rules or prompts:<br />
        <code>Work only inside <strong>server/schedulers/{targetFolder}/</strong>. Do NOT open, read, or modify anything in <strong>server/kernelroot/</strong> — that directory is off-limits.</code>
      </div>

      <p className={styles.hint}>
        Copy a prompt below and paste it into Claude Code to extend <code>{targetFolder}/</code>.
      </p>
      <div className={styles.promptList}>
        {targetPrompts.map(p => (
          <div key={p.label} className={styles.promptCard}>
            <div className={styles.promptMeta}>
              <span className={styles.promptLabel}>{p.label}</span>
              <CopyButton text={p.text} />
            </div>
            <pre className={styles.promptText}>{p.text}</pre>
          </div>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className={styles.layout}>

      {/* ── left column ─────────────────────────────────────── */}
      <div className={styles.container}>
        <h2 className={styles.heading}>scheduler assistant</h2>
        <p className={styles.sub}>Generate a fully wired scheduler scaffold in one click.</p>

        <div className={styles.inputRow}>
          <input
            className={styles.nameInput}
            type="text"
            placeholder="scheduler name  (e.g. image)"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            disabled={busy}
          />
          <button className="btn green" onClick={create} disabled={busy || !slug}>
            {busy ? 'creating…' : 'create'}
          </button>
        </div>

        {preview && (
          <div className={styles.preview}>
            → will create&nbsp; <code>server/{preview}</code>
          </div>
        )}

        {report && !report.ok && (
          <div className={styles.error}>{report.error}</div>
        )}

        <hr className={styles.divider} />

      <h2 className={styles.heading}>manage schedulers</h2>
      <p className={styles.sub}>Unregister or re-register any scheduler. User-created schedulers can also be permanently deleted.</p>

      {schedulers.length === 0 ? (
        <div className={styles.empty}>no schedulers found</div>
      ) : (() => {
        const anyBusy   = unregBusy || regBusy || delBusy
        const selected  = schedulers.find(s => s.name === delTarget)
        const isReg     = selected?.registered ?? true
        const isBuiltin = selected?.builtin ?? false
        return (
          <>
            <div className={styles.inputRow}>
              <select
                className={styles.nameInput}
                value={delTarget}
                onChange={e => { setDelTarget(e.target.value); clearDelResults() }}
                disabled={anyBusy}
              >
                <option value="">— select scheduler —</option>
                {schedulers.map(s => (
                  <option key={s.name} value={s.name}>
                    {s.name}_scheduler{s.builtin ? ' (built-in)' : s.registered ? '' : ' (unregistered)'}
                  </option>
                ))}
              </select>
              {isReg ? (
                <button className="btn amber" onClick={unregisterScheduler} disabled={anyBusy || !delTarget}>
                  {unregBusy ? 'unregistering…' : 'unregister'}
                </button>
              ) : (
                <button className="btn green" onClick={reregisterScheduler} disabled={anyBusy || !delTarget}>
                  {regBusy ? 'registering…' : 're-register'}
                </button>
              )}
              {!isBuiltin && (
                <button className="btn red" onClick={deleteScheduler} disabled={anyBusy || !delTarget}>
                  {delBusy ? 'deleting…' : deleteStep === 0 ? 'delete all' : deleteStep === 1 ? 'really delete?' : 'yes, delete'}
                </button>
              )}
            </div>
            {deleteStep === 1 && (
              <div className={styles.warnBox}>
                ⚠ This will permanently remove <code>{delTarget}_scheduler/</code> and all its code. Click <strong>really delete?</strong> to continue.
              </div>
            )}
            {deleteStep === 2 && (
              <div className={styles.warnBoxFinal}>
                ⚠ This cannot be undone. Click <strong>yes, delete</strong> to permanently delete all files.
              </div>
            )}
            <p className={styles.hint}>
              <strong>unregister</strong> — stops scheduling, keeps code &nbsp;|&nbsp;
              <strong>re-register</strong> — re-activates a paused scheduler
              {!isBuiltin && <> &nbsp;|&nbsp; <strong>delete all</strong> — removes code permanently (user-created only)</>}
            </p>
          </>
        )
      })()}

      {(unregResult && !unregResult.ok) && (
        <div className={styles.error}>{unregResult.error}</div>
      )}
      {(unregResult && unregResult.ok) && (
        <div className={styles.deleteReport}>
          <span className={styles.badge}>unregistered</span>
          <code>{unregResult.unregistered}</code>
          <span className={styles.hint}>
            {unregResult.scheduler_stopped
              ? ' — scheduler stopped'
              : ' — restart kernel to fully unload'}
          </span>
        </div>
      )}

      {(regResult && !regResult.ok) && (
        <div className={styles.error}>{regResult.error}</div>
      )}
      {(regResult && regResult.ok) && (
        <div className={styles.deleteReport}>
          <span className={styles.badge}>re-registered</span>
          <code>{regResult.registered}</code>
          <span className={styles.hint}>
            {regResult.scheduler_started ? ' — scheduler running' : ' — restart kernel to activate'}
          </span>
        </div>
      )}

      {(delResult && !delResult.ok) && (
          <div className={styles.error}>{delResult.error}</div>
        )}
        {(delResult && delResult.ok) && (
          <div className={styles.deleteReport}>
            <span className={styles.badgeDel}>deleted</span>
            <code>{delResult.deleted}</code>
            <span className={styles.hint}> — restart required to fully unload</span>
          </div>
        )}
      </div>

      {/* ── right column: prompts panel ─────────────────────── */}
      {promptsPanel}

    </div>
  )
}
