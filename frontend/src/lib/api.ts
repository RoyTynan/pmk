export interface Task {
  id: string
  prompt: string
  agent_type: string
  priority: number
  status: 'pending' | 'running' | 'done' | 'failed'
  llm: string | null
  target_llm: string | null
  token_budget: number | null
  input_tokens_est: number | null
  parent_id: string | null
  child_routing: string | null
  aggregate: number
  result: string | null
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
}

export interface ActivityEntry {
  id:          string
  ts:          number
  llm:         string
  model:       string | null
  provider:    string | null
  source:      string
  prompt_len:  number | null
  result_len:  number | null
  duration_ms: number | null
  ok:          number   // 1 = success, 0 = error
  error:       string | null
}

export interface ErrorEntry {
  id:         string
  ts:         number
  ts_human:   string
  level:      number
  level_name: string
  source:     string
  location:   string | null
  message:    string
  traceback:  string | null
}

export { LLMType } from './enums'
import type { LLMType } from './enums'

export interface LLM {
  name: string
  model: string
  url: string
  type: LLMType
  running: boolean
  use_gpu?: boolean
  provider?: string
  port?: number
  path?: string
  max_tasks?: number
}

export interface Agent {
  name: string
}

export interface SchedulerApiEntry {
  method:      string
  path:        string
  label:       string
  description: string
}

export interface SchedulerInfo {
  name:        string
  label:       string
  description: string
  api:         SchedulerApiEntry[]
  registered:  boolean
  builtin:     boolean
}

const BASE = '/api'
const j = (r: Response) => r.json()

export const api = {
  tasks:         ()                          => fetch(`${BASE}/tasks`).then(j) as Promise<Task[]>,
  tasksClear:          ()                     => fetch(`${BASE}/tasks/clear`,           { method: 'POST' }).then(j),
  tasksClearCompleted: ()                      => fetch(`${BASE}/tasks/clear-completed`,          { method: 'POST' }).then(j),
  tasksClearStatus:   (status: string)         => fetch(`${BASE}/tasks/clear-status/${status}`,   { method: 'POST' }).then(j),
  taskDelete:         (id: string)             => fetch(`${BASE}/tasks/${id}`,                    { method: 'DELETE' }).then(j),
  taskRequeue:        (id: string)             => fetch(`${BASE}/tasks/${id}/requeue`,            { method: 'POST' }).then(j),
  activityClear:      ()                       => fetch(`${BASE}/activity/clear`,                 { method: 'POST' }).then(j),
  errorsList:         (limit = 200)            => fetch(`${BASE}/errors?limit=${limit}`).then(j) as Promise<ErrorEntry[]>,
  errorsClear:        ()                       => fetch(`${BASE}/errors/clear`,                   { method: 'POST' }).then(j),
  errorsTest:         ()                       => fetch(`${BASE}/errors/test`,                    { method: 'POST' }).then(j),
  submit:        (body: {
    prompt: string; target_llm: string; agent_type: string
    child_routing: string; aggregate: boolean
  })                                         => fetch(`${BASE}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),

  kernelStatus:  ()                          => fetch(`${BASE}/kernel/status`).then(j) as Promise<{ running: boolean }>,
  kernelStart:   ()                          => fetch(`${BASE}/kernel/start`, { method: 'POST' }).then(j),
  kernelStop:    ()                          => fetch(`${BASE}/kernel/stop`,  { method: 'POST' }).then(j),

  multiStatus:    ()                          => fetch(`${BASE}/multi`).then(j) as Promise<{ enabled: boolean }>,
  multiOn:        ()                          => fetch(`${BASE}/multi/on`,  { method: 'POST' }).then(j),
  multiOff:       ()                          => fetch(`${BASE}/multi/off`, { method: 'POST' }).then(j),
  multiResponses: ()                          => fetch(`${BASE}/multi/responses`).then(j) as Promise<{ agent: string; content: string }[]>,
  multiPipeline:  (steps: { name: string; prompt: string }[]) =>
    fetch(`${BASE}/multi/pipeline/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps }) }),

  llms:          ()                          => fetch(`${BASE}/llms`).then(j) as Promise<LLM[]>,
  llmModels:     ()                          => fetch(`${BASE}/llms/models`).then(j) as Promise<{ name: string; type: string }[]>,
  llmBrowse:     (path?: string)             => fetch(`${BASE}/llms/browse${path ? '?path=' + encodeURIComponent(path) : ''}`).then(j) as Promise<{ path: string; parent: string | null; dirs: string[]; files: string[] }>,
  llmStart:      (name: string)              => fetch(`${BASE}/llms/${name}/start`, { method: 'POST' }).then(j),
  llmStop:       (name: string)              => fetch(`${BASE}/llms/${name}/stop`,  { method: 'POST' }).then(j),
  llmRemove:     (name: string)              => fetch(`${BASE}/llms/${name}`,       { method: 'DELETE' }).then(j),
  llmLog:        (name: string, lines = 50)  => fetch(`${BASE}/llms/${name}/log?lines=${lines}`).then(j),
  llmLogClear:   (name: string)              => fetch(`${BASE}/llms/${name}/log`, { method: 'DELETE' }).then(j),
  llmRegisterLocal: (body: {
    name: string; filename: string; port: number; use_gpu: boolean
  })                                         => fetch(`${BASE}/llms/register/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  llmRegisterRemote: (body: {
    name: string; url: string; model: string; provider?: string; type?: string
  })                                         => fetch(`${BASE}/llms/register/remote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  llmTest: (body: {
    name: string; url: string; model: string; provider?: string
  })                                         => fetch(`${BASE}/llms/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),

  agents:        ()                          => fetch(`${BASE}/agents`).then(j) as Promise<Agent[]>,

  systemPorts:   ()                          => fetch(`${BASE}/system/ports`).then(j) as Promise<{ monitor: number; kernel: number }>,

  schedulers:    ()                          => fetch(`${BASE}/schedulers`).then(j) as Promise<SchedulerInfo[]>,
  assistantCreate:      (name: string)       => fetch(`${BASE}/assistant/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(j),
  assistantUnregister:  (name: string)       => fetch(`${BASE}/assistant/scheduler/${name}/unregister`, { method: 'POST' }).then(j),
  assistantRegister:    (name: string)       => fetch(`${BASE}/assistant/scheduler/${name}/register`,   { method: 'POST' }).then(j),
  assistantDelete:      (name: string)       => fetch(`${BASE}/assistant/scheduler/${name}`, { method: 'DELETE' }).then(j),

}
