import { describe, expect, it, vi } from 'vitest'
import { createRemoteTransport } from './remote-transport.js'

class FakeSocket {
  readyState = 1
  sent = []

  send(frame) {
    this.sent.push(JSON.parse(frame))
  }

  close() {}

  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

function setup(options = {}) {
  let socket
  const transport = createRemoteTransport('ws://host:42069', {
    createSocket: () => (socket = new FakeSocket()),
    identify: async () => ({ version: '0.4.0', dev: false }),
    reload: vi.fn(),
    ...options,
  })
  return { transport, socket: () => socket }
}

describe('remote transport', () => {
  it('queues RPC until hello and resolves response', async () => {
    const { transport, socket } = setup()
    const pending = transport.invoke('packages:list', { direct: true })

    await vi.waitFor(() => expect(socket()).toBeTruthy())
    socket().receive({ t: 'hello', version: '0.4.0', dev: false })
    expect(socket().sent[0]).toMatchObject({
      t: 'rpc',
      channel: 'packages:list',
      args: [{ direct: true }],
    })

    socket().receive({ t: 'ok', id: socket().sent[0].id, result: ['ok'] })
    await expect(pending).resolves.toEqual(['ok'])
  })

  it('routes local channels and stubs without RPC', async () => {
    const localInvoke = vi.fn().mockResolvedValue('local')
    const { transport, socket } = setup({
      isLocalChannel: (channel) => channel === 'app:version',
      localInvoke,
      stubs: { 'wizard:browse-vam-dir': { cancelled: true } },
    })

    await expect(transport.invoke('app:version')).resolves.toBe('local')
    await expect(transport.invoke('wizard:browse-vam-dir')).resolves.toEqual({ cancelled: true })
    expect(localInvoke).toHaveBeenCalledWith('app:version', [])
    expect(socket()?.sent ?? []).toEqual([])
  })

  it('delivers events and reports connection state', async () => {
    const { transport, socket } = setup()
    const event = vi.fn()
    const status = vi.fn()
    transport.on('packages:updated', event)
    transport.remote.onStatus(status)

    await vi.waitFor(() => expect(socket()).toBeTruthy())
    socket().receive({ t: 'hello', version: '0.4.0', dev: false })
    socket().receive({ t: 'event', channel: 'packages:updated', data: { changed: true } })

    expect(event).toHaveBeenCalledWith({ changed: true })
    expect(status).toHaveBeenLastCalledWith({ connected: true, url: 'ws://host:42069', error: null })
  })
})
