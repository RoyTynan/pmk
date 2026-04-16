import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import next from 'next'

const port    = parseInt(process.env.PORT   || '3000', 10)
const backend = process.env.API_URL?.replace(/^http/, 'ws') ?? 'ws://localhost:8000'
const dev     = process.env.NODE_ENV !== 'production'

const app    = next({ dev, turbopack: true })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res))

  // Proxy WebSocket upgrades: browser → :3000/ws → :8000/ws
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') return  // let Next.js handle HMR and other WS upgrades

    wss.handleUpgrade(req, socket, head, browserWs => {
      const backendWs = new WebSocket(`${backend}/ws`)

      backendWs.on('open', () => {
        backendWs.on('message', (data, isBinary) => {
          if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data, { binary: isBinary })
        })
        browserWs.on('message', data => {
          if (backendWs.readyState === WebSocket.OPEN) backendWs.send(data)
        })
      })

      const close = () => { backendWs.close(); browserWs.close() }
      browserWs.on('close', close)
      backendWs.on('close', () => { if (browserWs.readyState === WebSocket.OPEN) browserWs.close() })
      backendWs.on('error', close)
    })
  })

  server.listen(port, () => {
    console.log(`> llm-os frontend ready on http://localhost:${port}`)
  })
})
