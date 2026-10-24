import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX, type DvdBridge } from '@shared/api'

/** Strips Electron's "Error invoking remote method 'x': Error: " prefix from main-process errors. */
function cleanError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}

const bridge: DvdBridge = {
  invoke: ((method: string, ...args: unknown[]) =>
    ipcRenderer.invoke(IPC_INVOKE_PREFIX + method, ...args).catch((error) => {
      throw cleanError(error)
    })) as DvdBridge['invoke'],
  on: (event, handler) => {
    const channel = IPC_EVENT_PREFIX + event
    const listener = (_: IpcRendererEvent, payload: unknown) => (handler as (p: unknown) => void)(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('dvd', bridge)
