import { SyncWatch } from './SyncWatch'

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname.split('/').filter(Boolean)
    const method = req.method

    if (path[0] === 'sync' && method === 'GET') {
      const password = url.searchParams.get('password')

      if (!password) {
        console.log('Missing password')
        return new Response('Missing password', { status: 401 })
      }
      if (password !== env.SYNC_WATCH_PASSWORD) {
        console.log('Invalid password')
        return new Response('Invalid password', { status: 401 })
      }

      const objectId = (env.SYNC_WATCH as unknown as DurableObjectNamespace<SyncWatch>).idFromName('instance')
      const stub = (env.SYNC_WATCH as unknown as DurableObjectNamespace<SyncWatch>).get(objectId)

      return stub.fetch(req)
    }

    return new Response('Not Found', { status: 404 })
  }
} satisfies ExportedHandler<Env>

export * from './SyncWatch'