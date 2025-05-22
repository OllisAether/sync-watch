import { DurableObject } from "cloudflare:workers"

interface VideoState {
  currentTime: number
  isPaused: boolean
  clients: {
    id: string
    name: string
  }[],
  roomId: string
}

export class SyncWatch extends DurableObject {
  rooms: Map<string, VideoState> = new Map()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    state.setHibernatableWebSocketEventTimeout(1000)
    state.blockConcurrencyWhile(async () => {
      // const videoState = await state.storage.get<VideoState>('videoState')
      // if (videoState) {
      //   this.videoState.currentTime = videoState.currentTime || 0
      //   this.videoState.isPaused = videoState.isPaused || true
      //   this.videoState.clients = videoState.clients || []
      // }

      const rooms = await state.storage.get<Record<string, VideoState>>('rooms')
      if (rooms) {
        this.rooms = new Map(Object.entries(rooms))
      }
    })
  }

  setVideoState(room: string, newState: Partial<VideoState>, info?: string) {
    const currentRoom = this.rooms.get(room) || {
      currentTime: 0,
      isPaused: true,
      clients: [],
      roomId: room,
    }
    const updatedRoom = {
      ...currentRoom,
      ...newState,
    }
    this.rooms.set(room, updatedRoom)
    this.ctx.storage.put('rooms', Object.fromEntries(this.rooms))
    this.broadcastVideoState(room, info)
  }

  async broadcastVideoState(room: string, info?: string) {
    const clients = this.ctx.getWebSockets('ROOM_ID-' + room)
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          ...this.rooms.get(room),
          currentClient: this.ctx.getTags(client)[0] || null,
          info,
        }))
      }
    })
  }

  webSocketMessage(ws: WebSocket, message: string): void {
    const data = JSON.parse(message.toString())
    const roomId = this.ctx.getTags(ws).find(tag => tag.startsWith('ROOM_ID-'))?.replace('ROOM_ID-', '')
    if (!roomId) return
    const clientId = this.ctx.getTags(ws).find(tag => tag.startsWith('ID-'))
    if (!clientId) return

    const clientName = this.rooms.get(roomId)?.clients.find(client => client.id === clientId)?.name || 'Anonymous'

    const room = this.rooms.get(roomId)
    if (!room) return

    if (data.type === 'sync' && data.currentTime !== undefined) {
      // Only update the state if the time difference is significant
      if (Math.abs(room.currentTime - data.currentTime) > 0.5) {
        this.setVideoState(roomId, {
          currentTime: data.currentTime
        })
      }
    } else if (data.type === 'getState') {
      ws.send(JSON.stringify({
        ...room,
        currentClient: this.ctx.getTags(ws)[0] || null,
      }))
    } else if (data.type === 'pause' && data.currentTime !== undefined) {
      this.setVideoState(roomId, {
        currentTime: data.currentTime,
        isPaused: true,
      }, `${clientName} paused`)
    } else if (data.type === 'play' && data.currentTime !== undefined) {
      this.setVideoState(roomId, {
        currentTime: data.currentTime,
        isPaused: false,
      }, `${clientName} resumed`)
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void> {
    console.log(`WebSocket closed: ${code} ${reason} ${wasClean}`)

    const roomId = this.ctx.getTags(ws).find(tag => tag.startsWith('ROOM_ID-'))?.replace('ROOM_ID-', '')
    if (!roomId) return
    const clientId = this.ctx.getTags(ws).find(tag => tag.startsWith('ID-'))
    if (!clientId) return
    const clientName = this.rooms.get(roomId)?.clients.find(client => client.id === clientId)?.name || 'Anonymous'


    if (this.ctx.getWebSockets('ROOM_ID-' + roomId).length === 0) {
      console.log('No clients left, deleting room', roomId)
      this.rooms.delete(roomId)
      this.ctx.storage.put('rooms', Object.fromEntries(this.rooms))
      return
    }

    this.setVideoState(roomId, {
      isPaused: true,
      clients: this.rooms.get(roomId)?.clients.filter(client => client.id !== clientId) ?? [],
    }, `${clientName} disconnected`)
  }

  async fetch(req: Request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    const url = new URL(req.url)
    const path = url.pathname.split('/').filter(Boolean)
    const clientName = url.searchParams.get('clientName') || 'Anonymous'
    let roomId = url.searchParams.get('room')

    let room: VideoState
    if (path[0] === 'create') {
      do {
        roomId = Array(4).fill(0).map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charAt(Math.floor(Math.random() * 36))).join('')
      } while (this.rooms.has(roomId))

      room = {
        currentTime: 0,
        isPaused: true,
        clients: [],
        roomId
      }
      this.ctx.storage.put('rooms', Object.fromEntries(this.rooms))
    } else {
      if (!roomId) {
        console.log('Sync request without room ID')
        return new Response('Room not specified', { status: 400 })
      }

      let _room = this.rooms.get(roomId)
      if (!_room) {
        console.log('Room not found')
        return new Response('Room not found', { status: 404 })
      }

      room = _room
    }

    const id = 'ID-' + Math.random().toString(36).substring(2, 15)
  
    this.setVideoState(roomId, {
      clients: [...room.clients, { id, name: clientName }],
    }, `${clientName} connected`)

    console.log('WebSocket connection established')
    this.ctx.acceptWebSocket(server, [id, 'ROOM_ID-' + roomId]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}