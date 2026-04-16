'use client'
import { useState } from 'react'
import styles from './JsonParserTab.module.css'

const BASE = '/api'

// --- types ---

type SchemaNode = string | SchemaObject | SchemaArray

interface SchemaObject {
  _type:   'object'
  _keys:   number
  _schema: Record<string, SchemaNode>
}

interface SchemaArray {
  _type:           'array'
  _items:          number
  _element_type:   string
  _element_schema?: SchemaNode
}

interface ParseResult {
  valid:     boolean
  type?:     string
  size?:     { chars: number; tokens: number }
  depth?:    number
  schema?:   SchemaNode
  warnings?: string[]
  error?:    string
  line?:     number
  column?:   number
}

interface Task {
  id:     string
  status: string
  result: string | null
  error:  string | null
}

const EXAMPLE = `{
  "name": "LLM Micro OS",
  "version": "1.0",
  "schedulers": ["llm", "file"],
  "features": {
    "kernel": true,
    "agents": ["echo", "planner"],
    "file_handlers": ["json"]
  },
  "config": {
    "poll_interval": 2,
    "token_ceiling": 4096,
    "debug": null
  }
}`

// --- schema tree renderer ---

const TYPE_CLASS: Record<string, string> = {
  string:  styles.tString,
  integer: styles.tNumber,
  float:   styles.tNumber,
  boolean: styles.tBoolean,
  null:    styles.tNull,
  object:  styles.tObject,
  array:   styles.tArray,
  mixed:   styles.tMixed,
  unknown: styles.tMuted,
}

function TypeChip({ t }: { t: string }) {
  return <span className={`${styles.typeChip} ${TYPE_CLASS[t] ?? styles.tMuted}`}>{t}</span>
}

function SchemaTree({ node, name, indent = 0 }: { node: SchemaNode; name?: string; indent?: number }) {
  const pad = indent * 14

  if (typeof node === 'string') {
    return (
      <div className={styles.schemaRow} style={{ paddingLeft: pad }}>
        {name && <span className={styles.schemaKey}>{name}</span>}
        <TypeChip t={node} />
      </div>
    )
  }

  if (node._type === 'array') {
    return (
      <>
        <div className={styles.schemaRow} style={{ paddingLeft: pad }}>
          {name && <span className={styles.schemaKey}>{name}</span>}
          <TypeChip t="array" />
          <span className={styles.schemaOf}>[{node._items}] of</span>
          <TypeChip t={node._element_type} />
        </div>
        {node._element_schema && typeof node._element_schema !== 'string' &&
          (node._element_schema as SchemaObject)._type === 'object' &&
          Object.entries((node._element_schema as SchemaObject)._schema).map(([k, v]) => (
            <SchemaTree key={k} name={k} node={v} indent={indent + 1} />
          ))
        }
      </>
    )
  }

  // object
  return (
    <>
      <div className={styles.schemaRow} style={{ paddingLeft: pad }}>
        {name && <span className={styles.schemaKey}>{name}</span>}
        <TypeChip t="object" />
        <span className={styles.schemaOf}>({node._keys} keys)</span>
      </div>
      {Object.entries(node._schema).map(([k, v]) => (
        <SchemaTree key={k} name={k} node={v} indent={indent + 1} />
      ))}
    </>
  )
}

// --- main component ---

export default function JsonParserTab() {
  const [input,   setInput]   = useState('')
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<ParseResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function submit() {
    if (!input.trim()) return
    setRunning(true)
    setResult(null)
    setError(null)

    try {
      const submitRes = await fetch(`${BASE}/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt: input, agent_type: 'jsonparser_parse_json', target_llm: '' }),
      })
      const { task_id } = await submitRes.json()

      let task: Task | null = null
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500))
        const res = await fetch(`${BASE}/tasks/${task_id}`)
        task = await res.json()
        if (task && (task.status === 'done' || task.status === 'failed')) break
      }

      if (!task)             { setError('No response from server'); return }
      if (task.status === 'failed') { setError(task.error || 'Task failed'); return }
      if (!task.result)      { setError('No result returned'); return }

      setResult(JSON.parse(task.result) as ParseResult)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  function clear() {
    setInput('')
    setResult(null)
    setError(null)
  }

  return (
    <div className={styles.container}>

      {/* left — input */}
      <div className={styles.left}>
        <div className={styles.toolbar}>
          <span className={styles.label}>JSON input</span>
          <button className={styles.btnGhost} onClick={() => setInput(EXAMPLE)}>load example</button>
          <button className={styles.btnGhost} onClick={clear}>clear</button>
        </div>
        <textarea
          className={styles.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste JSON here…"
          spellCheck={false}
        />
        <div className={styles.actions}>
          <button className={styles.btnRun} onClick={submit} disabled={running || !input.trim()}>
            {running ? '● parsing…' : '▶ parse & validate'}
          </button>
        </div>
      </div>

      {/* right — result */}
      <div className={styles.right}>
        <div className={styles.toolbar}>
          <span className={styles.label}>result</span>
        </div>

        {!result && !error && !running && (
          <div className={styles.empty}>Paste JSON on the left and click parse &amp; validate.</div>
        )}

        {running && <div className={styles.empty}>Parsing…</div>}

        {error && (
          <div className={styles.errorBox}>
            <span className={styles.badgeFail}>error</span>
            <span className={styles.errorMsg}>{error}</span>
          </div>
        )}

        {result && !result.valid && (
          <div className={styles.resultBox}>
            <div className={styles.resultHeader}>
              <span className={styles.badgeFail}>invalid JSON</span>
            </div>
            <table className={styles.metaTable}>
              <tbody>
                <tr><td>Error</td><td className={styles.errorMsg}>{result.error}</td></tr>
                {result.line   && <tr><td>Line</td>  <td>{result.line}</td></tr>}
                {result.column && <tr><td>Column</td><td>{result.column}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {result && result.valid && (
          <div className={styles.resultBox}>

            {/* header */}
            <div className={styles.resultHeader}>
              <span className={styles.badgePass}>valid JSON</span>
              <TypeChip t={result.type ?? 'unknown'} />
            </div>

            {/* meta */}
            <table className={styles.metaTable}>
              <tbody>
                {result.size && (
                  <tr>
                    <td>Size</td>
                    <td>{result.size.chars.toLocaleString()} chars · ~{result.size.tokens.toLocaleString()} tokens</td>
                  </tr>
                )}
                {result.depth !== undefined && (
                  <tr><td>Depth</td><td>{result.depth}</td></tr>
                )}
              </tbody>
            </table>

            {/* schema */}
            {result.schema && (
              <>
                <div className={styles.sectionLabel}>schema</div>
                <div className={styles.schemaTree}>
                  <SchemaTree node={result.schema} />
                </div>
              </>
            )}

            {/* warnings */}
            <div className={styles.sectionLabel}>
              warnings {result.warnings && result.warnings.length > 0
                ? <span className={styles.warnCount}>{result.warnings.length}</span>
                : null}
            </div>
            {result.warnings && result.warnings.length > 0 ? (
              <ul className={styles.warnList}>
                {result.warnings.map((w, i) => (
                  <li key={i} className={styles.warnItem}>⚠ {w}</li>
                ))}
              </ul>
            ) : (
              <div className={styles.warnNone}>none</div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
