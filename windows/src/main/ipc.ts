import { ipcMain, webContents, type BrowserWindow } from 'electron'
import { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX, type DvdApi, type DvdEventName, type DvdEvents } from '@shared/api'
import { CoreError } from './core/errors'
import { log } from './log'

/** Web contents that run the app's own renderer (sign-in / Studio windows never get events). */
const appContents = new Set<number>()

export function registerAppWindow(window: BrowserWindow): void {
  const id = window.webContents.id
  appContents.add(id)
  window.on('closed', () => appContents.delete(id))
}

/** A message that is safe and useful to show: ours (Vietnamese) or a generic one. */
function userMessage(method: string, error: unknown): string {
  if (error instanceof CoreError) return error.message
  const message = error instanceof Error ? error.message : String(error)
  // Messages written for the user contain Vietnamese letters; anything else is an internal error.
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(message)) return message
  log.error(`${method}: ${error instanceof Error && error.stack ? error.stack : message}`)
  return 'Đã xảy ra lỗi. Vui lòng thử lại.'
}

/** Registers every method of the API as an `ipcMain.handle` channel. */
export function registerApi(impl: DvdApi): void {
  for (const name of Object.keys(impl) as (keyof DvdApi)[]) {
    const fn = impl[name] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(IPC_INVOKE_PREFIX + name, async (event, ...args: unknown[]) => {
      if (!appContents.has(event.sender.id)) throw new Error('Không được phép.')
      try {
        return await fn(...args)
      } catch (error) {
        const message = userMessage(name, error)
        if (error instanceof CoreError) log.warn(`${name}: ${message}`)
        throw new Error(message)
      }
    })
  }
}

/** Sends an event to every app window. */
export function emit<K extends DvdEventName>(event: K, payload: DvdEvents[K]): void {
  for (const id of appContents) {
    const contents = webContents.fromId(id)
    if (contents && !contents.isDestroyed()) contents.send(IPC_EVENT_PREFIX + event, payload)
  }
}
