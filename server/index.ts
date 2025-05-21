import { SyncWatch } from './SyncWatch'

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname.split('/').filter(Boolean)
    const method = req.method

    if ((path[0] === 'sync' || path[0] === 'create') && method === 'GET') {
      const roomId = url.searchParams.get('room')

      if (!roomId && path[0] === 'sync') {
        console.log('Sync request without room ID')
        return new Response('Room not specified', { status: 400 })
      }

      const objectId = (env.SYNC_WATCH as unknown as DurableObjectNamespace<SyncWatch>).idFromName('instance')
      const stub = (env.SYNC_WATCH as unknown as DurableObjectNamespace<SyncWatch>).get(objectId)

      return stub.fetch(req)
    }

    return new Response('Not Found', { status: 404 })
  }
} satisfies ExportedHandler<Env>

export * from './SyncWatch'