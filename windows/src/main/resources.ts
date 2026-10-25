// Files from `windows/resources/` (icons, thumbar glyphs): copied next to the app by
// electron-builder (`extraResources`), read from the repo in development.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'

export function resourcePath(...parts: string[]): string {
  const packaged = join(process.resourcesPath, 'resources', ...parts)
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'resources', ...parts)
}

const cache = new Map<string, NativeImage>()

export function image(...parts: string[]): NativeImage {
  const file = resourcePath(...parts)
  let result = cache.get(file)
  if (!result) {
    result = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty()
    cache.set(file, result)
  }
  return result
}

export function appIcon(): NativeImage {
  return image('icon.png')
}

export function trayIcon(): NativeImage {
  if (process.platform === 'win32') return image('tray.ico')
  if (process.platform === 'darwin') {
    // A "template" image: macOS draws it black or white to match the menu bar.
    const template = image('trayTemplate.png')
    if (!template.isEmpty()) {
      template.setTemplateImage(true)
      return template
    }
  }
  return image('tray.png')
}
