'use client'
import { useEffect, useState } from 'react'
import { ModalProvider } from '@/components/Modal'
import { AppStateProvider, useAppState } from '@/contexts/AppState'
import TopBar from '@/components/TopBar'
import HostTab from '@/components/HostTab'
import MonitorTab from '@/components/MonitorTab'
import LLMsTab from '@/components/LLMsTab'
import LogsTab from '@/components/LogsTab'
import MultiTab from '@/components/MultiTab'
import AgenticTab from '@/components/AgenticTab'
import RayTab from '@/components/RayTab'
import AnalyseTab from '@/components/AnalyseTab'
import JsonParserTab from '@/components/JsonParserTab'
import SchedulerApi from '@/components/SchedulerApi'
import AssistantTab from '@/components/AssistantTab'
import SchedulerTab from '@/components/SchedulerTab'
import { api, type SchedulerInfo } from '@/lib/api'
import styles from './page.module.css'

type L1Tab = 'host' | 'schedulers' | 'assistant'
type L3Tab = 'llms' | 'single' | 'multi' | 'agentic' | 'ray' | 'analyse' | 'logs' | 'api'

const L1_TABS: L1Tab[] = ['host', 'schedulers', 'assistant']
const L3_TABS: L3Tab[] = ['llms', 'single', 'multi', 'agentic', 'ray', 'analyse', 'logs', 'api']

const BUILTIN_L2 = ['llm', 'jsonparser']

function WsDot() {
  const { connected } = useAppState()
  return (
    <span
      title={connected ? 'live' : 'reconnecting…'}
      style={{ color: connected ? '#4f4' : '#f44', fontSize: '0.7rem', marginLeft: '0.3rem' }}
    >●</span>
  )
}

function App() {
  const [l1, setL1] = useState<L1Tab>('host')
  const [l2, setL2] = useState<string>('llm')
  const [l3, setL3] = useState<L3Tab>('llms')
  const [userSchedulers, setUserSchedulers] = useState<SchedulerInfo[]>([])

  function loadSchedulers() {
    api.schedulers().then(setUserSchedulers).catch(() => {})
  }

  useEffect(() => { loadSchedulers() }, [])

  const l2Tabs = [...BUILTIN_L2, ...userSchedulers.filter(s => !s.builtin).map(s => s.name)]

  return (
    <>
      <TopBar wsDot={<WsDot />} />

      {/* Level 1 */}
      <div className={styles.tabs}>
        {L1_TABS.map(t => (
          <button key={t} className={`${styles.tab} ${l1 === t ? styles.active : ''}`} onClick={() => setL1(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className={styles.l1Content}>

        {/* ── Kernel ──────────────────────────────────────────── */}
        <div style={{ display: l1 === 'host' ? undefined : 'none' }}>
          <HostTab />
        </div>

        {/* ── Schedulers ──────────────────────────────────────── */}
        <div style={{ display: l1 === 'schedulers' ? undefined : 'none' }}>

          {/* Level 2 */}
          <div className={styles.tabs2}>
            {l2Tabs.map(t => (
              <button key={t} className={`${styles.tab2} ${l2 === t ? styles.active : ''}`} onClick={() => setL2(t)}>
                {t}
              </button>
            ))}
          </div>

          {/* ── LLM scheduler ───────────────────────────────── */}
          <div style={{ display: l2 === 'llm' ? undefined : 'none' }}>
            <div className={styles.tabs3}>
              {L3_TABS.map(t => (
                <button key={t} className={`${styles.tab3} ${l3 === t ? styles.active : ''}`} onClick={() => setL3(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div style={{ display: l3 === 'llms'    ? undefined : 'none' }}><LLMsTab /></div>
            <div style={{ display: l3 === 'single'  ? undefined : 'none' }}><MonitorTab /></div>
            <div style={{ display: l3 === 'multi'   ? undefined : 'none' }}><MultiTab /></div>
            <div style={{ display: l3 === 'agentic' ? undefined : 'none' }}><AgenticTab /></div>
            <div style={{ display: l3 === 'ray'     ? undefined : 'none' }}><RayTab /></div>
            <div style={{ display: l3 === 'analyse' ? undefined : 'none' }}><AnalyseTab /></div>
            <div style={{ display: l3 === 'logs'    ? undefined : 'none' }}><LogsTab /></div>
            <div style={{ display: l3 === 'api'     ? undefined : 'none' }}>
              <SchedulerApi scheduler="llm" monitorPrefixes={['/tasks', '/submit', '/agents', '/llms', '/multi', '/agentic', '/ray']} />
            </div>
          </div>

          {/* ── JSON Parser scheduler ───────────────────────── */}
          <div style={{ display: l2 === 'jsonparser' ? undefined : 'none' }}>
            <div className={styles.l2Content}>
              <JsonParserTab />
            </div>
          </div>

          {/* ── User-created schedulers ─────────────────────── */}
          {userSchedulers.filter(s => !s.builtin).map(info => (
            <div key={info.name} style={{ display: l2 === info.name ? undefined : 'none' }}>
              <div className={styles.l2Content}>
                <SchedulerTab info={info} />
              </div>
            </div>
          ))}

        </div>

        {/* ── Assistant ───────────────────────────────────────── */}
        <div style={{ display: l1 === 'assistant' ? undefined : 'none' }}>
          <AssistantTab schedulers={userSchedulers} onCreated={loadSchedulers} />
        </div>

      </div>
    </>
  )
}

export default function Page() {
  return (
    <ModalProvider>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </ModalProvider>
  )
}
