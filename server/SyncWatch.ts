import { DurableObject } from "cloudflare:workers"

interface VideoState {
  currentTime: number
  isPaused: boolean
  clients: {
    id: string
    name: string
  }[]
}

export class SyncWatch extends DurableObject {
  videoState: VideoState = {
    currentTime: 0,
    isPaused: true,
    clients: [],
  }

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    state.setHibernatableWebSocketEventTimeout(1000)
    state.blockConcurrencyWhile(async () => {
      const videoState = await state.storage.get<VideoState>('videoState')
      if (videoState) {
        this.videoState.currentTime = videoState.currentTime || 0
        this.videoState.isPaused = videoState.isPaused || true
        this.videoState.clients = videoState.clients || []
      }
    })
  }

  setVideoState(newState: Partial<VideoState>, info?: string) {
    this.videoState = {
      ...this.videoState,
      ...newState,
    }
    this.ctx.storage.put('videoState', this.videoState)
    this.broadcastVideoState(info)
  }

  async broadcastVideoState(info?: string) {
    const clients = this.ctx.getWebSockets()
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          ...this.videoState,
          currentClient: this.ctx.getTags(client)[0] || null,
          info,
        }))
      }
    })
  }

  webSocketMessage(ws: WebSocket, message: string): void {
    const data = JSON.parse(message.toString())
    const clientId = this.ctx.getTags(ws)[0]
    const clientName = this.videoState.clients.find(client => client.id === clientId)?.name || 'Anonymous'

    if (data.type === 'sync' && data.currentTime !== undefined) {
      // Only update the state if the time difference is significant
      if (Math.abs(this.videoState.currentTime - data.currentTime) > 0.5) {
        this.setVideoState({
          currentTime: data.currentTime
        })
      }
    } else if (data.type === 'getState') {
      ws.send(JSON.stringify({
        ...this.videoState,
        currentClient: this.ctx.getTags(ws)[0] || null,
      }))
    } else if (data.type === 'pause' && data.currentTime !== undefined) {
      this.setVideoState({
        currentTime: data.currentTime,
        isPaused: true,
      }, `${clientName} paused`)
    } else if (data.type === 'play' && data.currentTime !== undefined) {
      this.setVideoState({
        currentTime: data.currentTime,
        isPaused: false,
      }, `${clientName} resumed`)
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void> {
    console.log(`WebSocket closed: ${code} ${reason} ${wasClean}`)
    const clientId = this.ctx.getTags(ws)[0]
    const clientName = this.videoState.clients.find(client => client.id === clientId)?.name || 'Anonymous'

    if (this.ctx.getWebSockets().length === 0) {
      this.setVideoState({
        currentTime: 0,
        isPaused: true,
        clients: [],
      })
      return
    }

    this.setVideoState({
      isPaused: true,
      clients: this.videoState.clients.filter(client => client.id !== clientId),
    }, `${clientName} disconnected`)
  }

  async fetch(req: Request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    const url = new URL(req.url)
    const clientName = url.searchParams.get('clientName') || 'Anonymous'
    const id = Math.random().toString(36).substring(2, 15)
    this.setVideoState({
      clients: [...this.videoState.clients, { id, name: clientName }],
    }, `${clientName} connected`)

    console.log('WebSocket connection established')
    this.ctx.acceptWebSocket(server, [id]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}