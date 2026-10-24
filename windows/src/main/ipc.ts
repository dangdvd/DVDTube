import { BrowserWindow, ipcMain } from 'electron'
import { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX, type DvdApi, type DvdEventName, type DvdEvents } from '@shared/api'

/** Registers every method of the API as an `ipcMain.handle` channel. */
export function registerApi(impl: DvdApi): void {
  for (const name of Object.keys(impl) as (keyof DvdApi)[]) {
    const fn = impl[name] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(IPC_INVOKE_PREFIX + name, async (_event, ...args: unknown[]) => fn(...args))
  }
}

/** Sends an event to every window. */
export function emit<K extends DvdEventName>(event: K, payload: DvdEvents[K]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_EVENT_PREFIX + event, payload)
  }
}
