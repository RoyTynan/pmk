'use client'
import { useEffect, useRef, useState } from 'react'
import { api, LLMType } from '@/lib/api'
import { useAppState } from '@/contexts/AppState'
import { useModal } from './Modal'
import styles from './LLMsTab.module.css'

const PROVIDERS = [
  { id: '',           label: '— please select —',  url: '',                               needsKey: false, model: ''                     },
  { id: 'openai',     label: 'ChatGPT (OpenAI)',   url: 'https://api.openai.com/v1',      needsKey: true,  model: 'gpt-4o-mini'          },
  { id: 'anthropic',  label: 'Anthropic (Claude)', url: 'https://api.anthropic.com/v1',   needsKey: true,  model: 'claude-sonnet-4-6'    },
  { id: 'groq',       label: 'Groq',               url: 'https://api.groq.com/openai/v1', needsKey: true,  model: 'llama-3.3-70b-versatile' },
  { id: 'together',   label: 'Together AI',        url: 'https://api.together.xyz/v1',    needsKey: true,  model: 'meta-llama/Llama-3-8b-chat-hf' },
  { id: 'lan-llama',  label: 'LAN (llama-server)', url: 'http://localhost:8080/v1',       needsKey: false, model: ''                     },
  { id: 'lan-ollama', label: 'LAN (Ollama)',        url: 'http://localhost:11434/v1',      needsKey: false, model: ''                     },
  { id: 'custom',     label: 'Custom',              url: '',                               needsKey: false, model: ''                     },
]

export default function LLMsTab() {
  const { llms } = useAppState()
  const modal = useModal()

  const localFormRef  = useRef<HTMLDivElement>(null)
  const remoteFormRef = useRef<HTMLDivElement>(null)
  const cloudFormRef  = useRef<HTMLDivElement>(null)

  const [models, setModels]             = useState<{ name: string; type: string }[]>([])
  const [reservedPorts, setReservedPorts] = useState<number[]>([])
  const [localFile,       setLocalFile]       = useState('')
  const [localUseCustom,  setLocalUseCustom]  = useState(false)
  const [browseDir,       setBrowseDir]       = useState('')
  const [browseDirInput,  setBrowseDirInput]  = useState('')
  const [browseDirs,      setBrowseDirs]      = useState<string[]>([])
  const [browseFiles,     setBrowseFiles]     = useState<string[]>([])
  const [browseParent,    setBrowseParent]    = useState<string | null>(null)
  const [browseLoading,   setBrowseLoading]   = useState(false)
  const [browseFile,      setBrowseFile]      = useState('')
  const [localName, setLocalName] = useState('')
  const [localPort, setLocalPort] = useState('8082')
  const [localGpu, setLocalGpu]   = useState(true)
  const [localMsg, setLocalMsg]   = useState('')
  const [localErr, setLocalErr]   = useState(false)
  const [remoteName, setRemoteName]   = useState('')
  const [remoteUrl, setRemoteUrl]     = useState('')
  const [remoteModel, setRemoteModel] = useState('')
  const [remoteMsg, setRemoteMsg]     = useState('')
  const [remoteErr, setRemoteErr]     = useState(false)
  const [cloudProvider, setCloudProvider] = useState('')
  const [cloudName,     setCloudName]     = useState('')
  const [cloudUrl,      setCloudUrl]      = useState('')
  const [cloudModel,    setCloudModel]    = useState('')
  const [cloudMsg,        setCloudMsg]        = useState('')
  const [cloudErr,        setCloudErr]        = useState(false)
  const [cloudTestResult, setCloudTestResult] = useState<unknown>(null)
  const [sysMsg, setSysMsg] = useState('')

  useEffect(() => {
    api.llmModels().then(m => { setModels(m) })
    api.systemPorts().then(p => setReservedPorts([p.monitor, p.host]))
  }, [])

  async function startLLM(name: string) { await api.llmStart(name) }
  async function stopLLM(name: string)  { await api.llmStop(name) }

  async function removeLLM(name: string) {
    if (!await modal.show('remove LLM', `Remove "${name}" from the registry?\n\nIf it is a local server it will be stopped.`)) return
    await api.llmRemove(name)
  }

  async function editLLM(name: string) {
    const all = await api.llms()
    const llm = all.find(l => l.name === name)
    if (!llm) return

    if (llm.type === LLMType.LOCAL) {
      setLocalName(llm.name)
      setLocalFile(llm.model)
      setLocalPort(String(llm.port || '8082'))
      setLocalGpu(llm.use_gpu !== false)
      setLocalMsg(''); setLocalErr(false)
      localFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    } else if (llm.type === LLMType.CLOUD) {
      setCloudProvider(llm.provider || '')
      setCloudName(llm.name)
      setCloudUrl(llm.url)
      setCloudModel(llm.model)
      setCloudMsg(''); setCloudErr(false); setCloudTestResult(null)
      cloudFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    } else {
      setRemoteName(llm.name)
      setRemoteUrl(llm.url)
      setRemoteModel(llm.model)
      setRemoteMsg(''); setRemoteErr(false)
      remoteFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function localPortError(): string | null {
    const port = parseInt(localPort)
    if (isNaN(port) || port < 1024 || port > 65535) return 'port must be 1024–65535'
    if (reservedPorts.includes(port)) return `port ${port} is reserved by the app`
    const clash = llms.find(l => l.port === port && l.name !== localName)
    if (clash) return `port ${port} already used by "${clash.name}"`
    return null
  }

  async function registerLocal() {
    const fileValue = localUseCustom ? (browseFile ? `${browseDir}/${browseFile}` : '') : localFile
    if (!localName || !fileValue) { setLocalMsg('name and file required'); setLocalErr(true); return }
    const portErr = localPortError()
    if (portErr) { setLocalMsg(portErr); setLocalErr(true); return }
    const data = await api.llmRegisterLocal({
      name: localName, filename: fileValue,
      port: parseInt(localPort), use_gpu: localGpu,
    })
    if (data.registered) {
      setLocalName(''); setLocalPort('8082')
      setLocalMsg(`${localName} registered`); setLocalErr(false)
      setTimeout(() => setLocalMsg(''), 4000)
    } else {
      setLocalMsg('failed'); setLocalErr(true)
    }
  }

  async function browse(path?: string) {
    setBrowseLoading(true)
    try {
      const res = await api.llmBrowse(path)
      setBrowseDir(res.path)
      setBrowseDirInput(res.path)
      setBrowseParent(res.parent)
      setBrowseDirs(res.dirs)
      setBrowseFiles(res.files)
      setBrowseFile('')
    } catch { /* ignore */ }
    setBrowseLoading(false)
  }

  async function testRemote() {
    const data = await api.llmTest({ name: '_test', url: remoteUrl, model: remoteModel })
    setRemoteMsg(data.ok ? '✓ reachable' : `✗ ${data.error || 'unreachable'}`)
    setRemoteErr(!data.ok)
  }

  async function registerRemote() {
    if (!remoteName || !remoteUrl || !remoteModel) { setRemoteMsg('all fields required'); setRemoteErr(true); return }
    await api.llmRegisterRemote({ name: remoteName, url: remoteUrl, model: remoteModel })
    setRemoteName(''); setRemoteUrl(''); setRemoteModel('')
    setRemoteMsg('registered'); setRemoteErr(false)
    setTimeout(() => setRemoteMsg(''), 4000)
  }

  function changeProvider(id: string) {
    const p = PROVIDERS.find(p => p.id === id)!
    setCloudProvider(id)
    setCloudUrl(p.url)
    setCloudModel(p.model)
  }

  async function testCloud() {
    if (!cloudUrl)   { setCloudMsg('url required');   setCloudErr(true); return }
    if (!cloudModel) { setCloudMsg('model required'); setCloudErr(true); return }
    setCloudMsg('testing…'); setCloudErr(false); setCloudTestResult(null)
    const data = await api.llmTest({ name: '_test', url: cloudUrl, model: cloudModel, provider: cloudProvider })
    setCloudMsg(data.ok ? '✓ reachable' : `✗ ${data.error || 'unreachable'}`)
    setCloudErr(!data.ok)
    if (data.data !== undefined) setCloudTestResult(data.data)
  }

  async function registerCloud() {
    if (!cloudProvider) { setCloudMsg('please select a provider'); setCloudErr(true); return }
    if (!cloudName)  { setCloudMsg('name required');  setCloudErr(true); return }
    if (!cloudUrl)   { setCloudMsg('url required');   setCloudErr(true); return }
    if (!cloudModel) { setCloudMsg('model required'); setCloudErr(true); return }
    setCloudMsg('testing…'); setCloudErr(false)
    const test = await api.llmTest({ name: '_test', url: cloudUrl, model: cloudModel, provider: cloudProvider })
    if (!test.ok) { setCloudMsg(`✗ ${test.error || 'unreachable'} — not registered`); setCloudErr(true); return }
    await api.llmRegisterRemote({ name: cloudName, url: cloudUrl, model: cloudModel, provider: cloudProvider, type: 'cloud' })
    setCloudMsg(`registered ${cloudName}`); setCloudErr(false)
    setCloudName(''); setCloudModel('')
    setTimeout(() => setCloudMsg(''), 4000)
  }

  async function clearDB() {
    if (!await modal.show('clear database', 'Delete all tasks? This cannot be undone.')) return
    await api.tasksClear()
    setSysMsg('db cleared')
  }

  return (
    <div>
      <h2>llm servers</h2>
      <table className={styles.table}>
        <thead>
          <tr><th></th><th>NAME</th><th>MODEL</th><th>URL</th><th>TYPE</th><th>ACTIONS</th></tr>
        </thead>
        <tbody>
          {llms.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: '#444', fontSize: '0.85rem', padding: '0.6rem 0.5rem' }}>
                no models registered — use the forms below to add one
              </td>
            </tr>
          )}
          {llms.map(l => (
            <tr key={l.name}>
              <td><span className={`${styles.dot} ${l.running ? styles.on : styles.off}`}>
                {l.running ? '●' : '○'}
              </span></td>
              <td>{l.name}</td>
              <td className={styles.dim}>{l.model.slice(0, 35)}</td>
              <td className={styles.dim}>{l.url}</td>
              <td className={styles.faint}>{l.type}</td>
              <td>
                {l.type === LLMType.LOCAL && (
                  <button className={`btn small ${l.running ? 'red' : 'green'}`}
                      onClick={() => l.running ? stopLLM(l.name) : startLLM(l.name)}>
                    {l.running ? 'stop' : 'start'}
                  </button>
                )}
                {' '}
                <button className="btn small amber" onClick={() => editLLM(l.name)}>edit</button>
                {' '}
                <button className="btn small red" onClick={() => removeLLM(l.name)}>remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.forms}>
        <div className={styles.form} ref={localFormRef}>
          <h3>add local model</h3>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            {localUseCustom ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div className="row">
                  {browseParent && (
                    <button className="btn small" onClick={() => browse(browseParent)} disabled={browseLoading}>↑</button>
                  )}
                  <input
                    type="text"
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.82rem' }}
                    value={browseDirInput}
                    placeholder="directory path…"
                    onChange={e => setBrowseDirInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && browse(browseDirInput)}
                  />
                  <button className="btn small" onClick={() => browse(browseDirInput)} disabled={browseLoading}>
                    {browseLoading ? '…' : 'go'}
                  </button>
                  {!browseDir && (
                    <button className="btn small" onClick={() => browse()}>home</button>
                  )}
                </div>
                {browseDirs.length > 0 && (
                  <select style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem' }}
                    value="" onChange={e => e.target.value && browse(`${browseDir}/${e.target.value}`)}>
                    <option value="">— subdirectories —</option>
                    {browseDirs.map(d => <option key={d} value={d}>📁 {d}</option>)}
                  </select>
                )}
                <select
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.82rem' }}
                  value={browseFile}
                  onChange={e => setBrowseFile(e.target.value)}
                >
                  <option value="">— select model file —</option>
                  {browseFiles.map(f => <option key={f} value={f}>{f}</option>)}
                  {browseDir && browseFiles.length === 0 && <option disabled>no model files here</option>}
                </select>
                {browseFile && (
                  <div style={{ fontSize: '0.78rem', color: '#666', fontFamily: 'monospace' }}>
                    {browseDir}/{browseFile}
                  </div>
                )}
              </div>
            ) : (
              <select style={{ flex: 1 }} value={localFile} onChange={e => setLocalFile(e.target.value)}>
                <option value="">— select model —</option>
                {models.filter(f => f.type === 'local').length
                  ? models.filter(f => f.type === 'local').map(f => <option key={f.name} value={f.name}>{f.name}</option>)
                  : <option disabled>no local model files found</option>}
              </select>
            )}
            <button
              className="btn small"
              style={{ whiteSpace: 'nowrap', alignSelf: 'flex-start' }}
              onClick={() => { setLocalUseCustom(v => !v); if (!browseDir) browse() }}
            >
              {localUseCustom ? 'pick from list' : 'browse…'}
            </button>
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="text" placeholder="name" style={{ flex: 1 }} value={localName} onChange={e => setLocalName(e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="number" placeholder="port" style={{ flex: 1 }} value={localPort} onChange={e => setLocalPort(e.target.value)} />
            {localPortError() && <span className={styles.err} style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>{localPortError()}</span>}
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <select style={{ flex: 1 }} value={localGpu ? 'gpu' : 'cpu'} onChange={e => setLocalGpu(e.target.value === 'gpu')}>
              <option value="gpu">Use graphics card (GPU) — faster</option>
              <option value="cpu">Use processor only (CPU) — slower, no graphics card needed</option>
            </select>
          </div>
          <button className="btn green" onClick={registerLocal}>register &amp; start</button>
          {localMsg && <div className={`${styles.formMsg} ${localErr ? styles.err : ''}`}>{localMsg}</div>}
          <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.3rem' }}>
            tip: register the same model twice with different names and ports to run CPU and GPU instances side by side
          </div>
        </div>

        <div className={styles.form} ref={remoteFormRef}>
          <h3>add remote (lan) server</h3>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="text" placeholder="name" style={{ flex: 1 }} value={remoteName} onChange={e => setRemoteName(e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="text" placeholder="http://host:port/v1" style={{ flex: 1 }} value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="text" placeholder="model name" style={{ flex: 1 }} value={remoteModel} onChange={e => setRemoteModel(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn" onClick={testRemote}>test</button>
            <button className="btn green" onClick={registerRemote}>register</button>
            {remoteMsg && <span className={`${styles.formMsg} ${remoteErr ? styles.err : ''}`}>{remoteMsg}</span>}
          </div>
        </div>

        <div className={styles.form} ref={cloudFormRef}>
          <h3>add cloud / provider</h3>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <select value={cloudProvider} onChange={e => changeProvider(e.target.value)} style={{ flex: 1 }}>
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input type="text" placeholder="name" style={{ width: 90 }} value={cloudName} onChange={e => setCloudName(e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="text" placeholder="base url" style={{ flex: 1 }} value={cloudUrl} onChange={e => setCloudUrl(e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <input type="text" placeholder="model (e.g. gpt-4o)" style={{ flex: 1 }} value={cloudModel} onChange={e => setCloudModel(e.target.value)} />
          </div>
          {PROVIDERS.find(p => p.id === cloudProvider)?.needsKey && (
            <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem', fontFamily: 'monospace' }}>
              API key: set <strong>{cloudProvider.toUpperCase()}_API_KEY</strong> in your .env file
            </div>
          )}
          <div className="row">
            <button className="btn" onClick={testCloud}>test</button>
            <button className="btn green" onClick={registerCloud}>register</button>
            {cloudMsg && <span className={`${styles.formMsg} ${cloudErr ? styles.err : ''}`}>{cloudMsg}</span>}
          </div>
          {cloudTestResult !== null && (
            <pre className={styles.testResult}>{JSON.stringify(cloudTestResult, null, 2)}</pre>
          )}
        </div>
      </div>

      <div className={styles.sysControls}>
        <span className={styles.sysLabel}>system:</span>
        <button className="btn red" onClick={clearDB}>clear db</button>
        {sysMsg && <span className={styles.recoverMsg}>{sysMsg}</span>}
      </div>
    </div>
  )
}
