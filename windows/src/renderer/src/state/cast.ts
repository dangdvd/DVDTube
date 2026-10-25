// "Truyền tới DVDTube" from this computer: the receivers found on the network (TVs and PCs
// running DVDTube), the device picker, and the remote control of the connected receiver
// (its /api/status polled every second while connected).

import { create } from 'zustand'
import type { CastAction, CastDevice, CastStatus, VideoItem } from '@shared/models'
import { api, errorMessage, onEvent } from '@/lib/api'
import { toast } from '@/lib/toast'
import { usePlayer } from './player'

interface PickerState {
  /** Video to send when a receiver is picked (else what plays now). */
  video?: VideoItem | null
  /** "Thêm vào hàng đợi trên TV". */
  mode: 'play' | 'queue'
}

interface CastStore {
  devices: CastDevice[]
  scanning: boolean
  picker: PickerState | null
  connected: CastDevice | null
  status: CastStatus | null
  /** The last polls failed. */
  lost: boolean

  openPicker(video?: VideoItem | null, mode?: 'play' | 'queue'): void
  closePicker(): void
  refresh(): Promise<void>
  addDevice(address: string): Promise<CastDevice>
  forget(id: string): Promise<void>
  /** Starts casting to `device` (or only queues `video` there). */
  pick(device: CastDevice): Promise<void>
  /** Sends a video (with its queue) to the connected receiver. */
  send(video: VideoItem, options?: { startSeconds?: number | null; queue?: VideoItem[]; index?: number; playlistId?: string | null }): Promise<void>
  queue(video: VideoItem, next: boolean): Promise<void>
  control(action: CastAction, value?: number | null): void
  /** "Ngắt kết nối"; `resumeHere` = "Tiếp tục trên thiết bị này". */
  disconnect(resumeHere?: boolean): Promise<void>
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let failures = 0
let scanTimer: ReturnType<typeof setInterval> | null = null

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  failures = 0
}

export const useCast = create<CastStore>((set, get) => ({
  devices: [],
  scanning: false,
  picker: null,
  connected: null,
  status: null,
  lost: false,

  openPicker(video, mode = 'play') {
    set({ picker: { video: video ?? null, mode } })
    void get().refresh()
    if (scanTimer) clearInterval(scanTimer)
    scanTimer = setInterval(() => void api.castScan().catch(() => {}), 20_000)
  },
  closePicker() {
    set({ picker: null })
    if (scanTimer) clearInterval(scanTimer)
    scanTimer = null
  },
  async refresh() {
    set({ scanning: true })
    try {
      await api.castScan()
      set({ devices: await api.castDevices() })
    } catch {
      // keep the previous list
    }
    setTimeout(() => {
      void api
        .castDevices()
        .then((devices) => set({ devices }))
        .catch(() => {})
        .finally(() => set({ scanning: false }))
    }, 2500)
  },
  async addDevice(address) {
    const device = await api.castAddDevice(address)
    set({ devices: [device, ...get().devices.filter((d) => d.id !== device.id)] })
    return device
  },
  async forget(id) {
    await api.castForgetDevice(id).catch(() => {})
    set({ devices: get().devices.filter((d) => d.id !== id) })
  },
  async pick(device) {
    const picker = get().picker
    get().closePicker()
    const p = usePlayer.getState()
    if (picker?.mode === 'queue' && picker.video) {
      try {
        await api.castQueue(device, picker.video, false)
        toast(`Đã thêm vào hàng đợi trên ${device.name}`)
      } catch (error) {
        toast(errorMessage(error))
      }
      return
    }
    const video = picker?.video ?? p.current
    if (get().connected && get().connected!.id !== device.id) await get().disconnect(false)
    set({ connected: device, status: null, lost: false })
    startPolling()
    if (!video) {
      toast(`Đã kết nối với ${device.name}`)
      return
    }
    const same = video.id === p.current?.id
    // Local playback pauses; the receiver continues from here.
    if (p.playing) p.pause()
    await get().send(video, {
      startSeconds: same && p.currentTime > 1 ? p.currentTime : null,
      queue: same && p.queue.length > 1 ? p.queue : undefined,
      index: same && p.queue.length > 1 ? p.queueIndex : undefined,
      playlistId: same ? p.playlistId : null,
    })
  },
  async send(video, options = {}) {
    const device = get().connected
    if (!device) return
    try {
      await api.castPlay(device, {
        video,
        startSeconds: options.startSeconds ?? null,
        queue: options.queue && options.queue.length > 1 ? options.queue : null,
        index: options.queue && options.queue.length > 1 ? (options.index ?? 0) : null,
        playlistId: options.playlistId ?? null,
      })
      toast(`Đang phát trên ${device.name}`)
    } catch (error) {
      toast(`Không truyền được tới ${device.name}: ${errorMessage(error)}`)
    }
  },
  async queue(video, next) {
    const device = get().connected
    if (!device) return
    try {
      await api.castQueue(device, video, next)
      toast(next ? `Sẽ phát tiếp theo trên ${device.name}` : `Đã thêm vào hàng đợi trên ${device.name}`)
    } catch (error) {
      toast(errorMessage(error))
    }
  },
  control(action, value = null) {
    const device = get().connected
    if (!device) return
    // Optimistic UI for the usual buttons.
    const status = get().status
    if (status) {
      if (action === 'toggle' || action === 'play' || action === 'pause') {
        const playing = action === 'play' || (action === 'toggle' && status.state !== 'playing')
        set({ status: { ...status, state: playing ? 'playing' : 'paused' } })
      } else if (action === 'seek' && value !== null) set({ status: { ...status, position: value } })
      else if (action === 'skip' && value !== null) set({ status: { ...status, position: Math.max(0, status.position + value) } })
      else if (action === 'volume' && value !== null) set({ status: { ...status, volume: value, muted: false } })
    }
    api.castControl(device, action, value).catch((error) => toast(errorMessage(error)))
  },
  async disconnect(resumeHere = false) {
    const device = get().connected
    const status = get().status
    stopPolling()
    set({ connected: null, status: null, lost: false })
    if (!device) return
    if (resumeHere && status?.video) {
      api.castControl(device, 'pause', null).catch(() => {})
      const queue = status.queue.length > 1 ? status.queue : undefined
      usePlayer.getState().play(status.video, { startAt: status.position > 1 ? status.position : null, queue, index: queue ? status.index : undefined })
      toast('Tiếp tục phát trên máy tính này')
    } else {
      api.castControl(device, 'stop', null).catch(() => {})
      toast(`Đã ngắt kết nối với ${device.name}`)
    }
  },
}))

function startPolling(): void {
  stopPolling()
  const poll = async () => {
    const device = useCast.getState().connected
    if (!device) return stopPolling()
    try {
      const status = await api.castStatus(device)
      if (useCast.getState().connected?.id !== device.id) return
      failures = 0
      useCast.setState({ status, lost: false })
      // The player store mirrors what the receiver plays (watch page, mini bar, history).
      const p = usePlayer.getState()
      if (status.video && status.video.id !== p.current?.id) usePlayer.setState({ current: status.video, queue: status.queue.length ? status.queue : [status.video], queueIndex: status.index })
    } catch {
      failures++
      if (failures >= 3) useCast.setState({ lost: true })
      if (failures >= 10) {
        toast(`Mất kết nối với ${device.name}`)
        void useCast.getState().disconnect(false)
      }
    }
  }
  void poll()
  pollTimer = setInterval(() => void poll(), 1000)
}

/** The connected receiver, if any (the player sends what the user plays there). */
export function castTarget(): CastDevice | null {
  return useCast.getState().connected
}

let started = false

export function startCastDiscovery(): void {
  if (started) return
  started = true
  onEvent('castDevices', (devices) => useCast.setState({ devices }))
}
