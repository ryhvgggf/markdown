import * as Y from 'yjs'

/** Origin for updates applied from another tab; never rebroadcast, never persisted by this tab. */
export const TAB_ORIGIN: unique symbol = Symbol('tabs-bridge')

type Msg =
  | { type: 'update'; data: Uint8Array }
  | { type: 'sync-step1'; sv: Uint8Array; reply: boolean }
  | { type: 'sync-step2'; data: Uint8Array }

/** Syncs `doc` with other tabs of the same docId over BroadcastChannel. Returns a disconnect function. */
export function connectTabs(
  doc: Y.Doc,
  docId: string,
  channelFactory: (name: string) => BroadcastChannel = (n) => new BroadcastChannel(n),
): () => void {
  const channel = channelFactory(`notes-v2:${docId}`)
  let closed = false
  const send = (m: Msg) => {
    if (!closed) channel.postMessage(m)
  }

  const onDocUpdate = (data: Uint8Array, origin: unknown) => {
    if (origin === TAB_ORIGIN) return
    send({ type: 'update', data })
  }

  channel.onmessage = (ev: MessageEvent) => {
    if (closed) return
    const m = ev.data as Msg
    switch (m.type) {
      case 'update':
      case 'sync-step2':
        Y.applyUpdate(doc, m.data, TAB_ORIGIN)
        break
      case 'sync-step1':
        send({ type: 'sync-step2', data: Y.encodeStateAsUpdate(doc, m.sv) })
        // Ask for what the peer has that we lack (only once, to avoid ping-pong).
        if (m.reply) send({ type: 'sync-step1', sv: Y.encodeStateVector(doc), reply: false })
        break
    }
  }

  doc.on('update', onDocUpdate)
  send({ type: 'sync-step1', sv: Y.encodeStateVector(doc), reply: true })

  return () => {
    if (closed) return
    closed = true
    doc.off('update', onDocUpdate)
    channel.onmessage = null
    channel.close()
  }
}
