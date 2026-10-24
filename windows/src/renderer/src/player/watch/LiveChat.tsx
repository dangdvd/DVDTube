// Live chat beside a live stream (polled, honouring YouTube's timeout), or the chat replay of
// a finished stream (messages appear in sync with the video position).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LiveChatInfo, LiveChatMessage } from '@shared/models'
import { api, errorMessage } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { usePlayer } from '@/state/player'
import { PIcon } from '../ui/icons'

const MAX_MESSAGES = 250

function Message({ message }: { message: LiveChatMessage }) {
  return (
    <div className={'dp-chat-message' + (message.amount ? ' dp-chat-message--paid' : '')}>
      {message.authorPhoto ? <img className="dp-avatar" src={message.authorPhoto} alt="" width={24} height={24} loading="lazy" /> : <span className="dp-avatar dp-avatar--letter" style={{ width: 24, height: 24 }}>{message.author.charAt(0)}</span>}
      <div className="dp-chat-text">
        <span className={'dp-chat-author' + (message.isOwner ? ' dp-chat-author--owner' : message.isModerator ? ' dp-chat-author--mod' : message.isMember ? ' dp-chat-author--member' : '')}>
          {message.author}
          {message.isModerator ? ' 🔧' : ''}
        </span>
        {message.amount ? <span className="dp-chat-amount">{message.amount}</span> : null}
        <span className="dp-chat-body">{message.message}</span>
      </div>
    </div>
  )
}

export function LiveChat({ info, videoId }: { info: LiveChatInfo; videoId: string }) {
  const signedIn = useAccount((s) => s.signedIn)
  const [modeIndex, setModeIndex] = useState(0)
  const [messages, setMessages] = useState<LiveChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sendParams, setSendParams] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const mode = info.modes[modeIndex] ?? info.modes[0]

  // Live: poll the continuation chain.
  useEffect(() => {
    if (!mode || info.isReplay || !open) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let continuation: string | null = mode.continuation
    setMessages([])
    setError(null)
    const poll = async () => {
      if (!alive || !continuation) return
      try {
        const page = await api.liveChat(continuation, false)
        if (!alive) return
        continuation = page.continuation ?? null
        setSendParams(page.sendParams ?? null)
        if (page.messages.length) {
          setMessages((list) => {
            const seen = new Set(list.map((m) => m.id))
            return [...list, ...page.messages.filter((m) => !seen.has(m.id))].slice(-MAX_MESSAGES)
          })
        }
        if (!continuation) {
          setError('Cuộc trò chuyện đã kết thúc')
          return
        }
        timer = setTimeout(poll, Math.min(10_000, Math.max(1000, page.timeoutMs || 3000)))
      } catch (failure) {
        if (!alive) return
        setError(errorMessage(failure) || 'Không tải được trò chuyện.')
        timer = setTimeout(poll, 8000)
      }
    }
    void poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [mode, info.isReplay, open, videoId])

  // Replay: fetch chunks ahead of the playhead, show what is due.
  useEffect(() => {
    if (!mode || !info.isReplay || !open) return
    let alive = true
    let buffer: LiveChatMessage[] = []
    let continuation: string | null = mode.continuation
    let fetching = false
    let fetchedUntil = -1
    let lastTime = usePlayer.getState().currentTime
    setMessages([])
    setError(null)
    const fetchMore = async (fromMs: number, restart: boolean) => {
      if (fetching || (!continuation && !restart)) return
      fetching = true
      try {
        const page = await api.liveChat(restart ? mode.continuation : continuation!, true, fromMs)
        if (!alive) return
        continuation = page.continuation ?? null
        if (restart) buffer = []
        buffer = [...buffer, ...page.messages].sort((a, b) => (a.offsetMs ?? 0) - (b.offsetMs ?? 0))
        fetchedUntil = buffer.length ? (buffer[buffer.length - 1].offsetMs ?? fromMs) : fromMs + 10_000
      } catch (failure) {
        if (alive) setError(errorMessage(failure) || 'Không tải được trò chuyện.')
      } finally {
        fetching = false
      }
    }
    const timer = setInterval(() => {
      const now = usePlayer.getState().currentTime
      const nowMs = now * 1000
      if (now < lastTime - 3 || now > lastTime + 30) {
        // Seeked: start again from the new position.
        void fetchMore(nowMs, true)
        setMessages([])
      } else if (fetchedUntil < nowMs + 5000) {
        void fetchMore(Math.max(nowMs, fetchedUntil), fetchedUntil < 0)
      }
      lastTime = now
      const due = buffer.filter((m) => (m.offsetMs ?? 0) <= nowMs)
      setMessages((list) => (list.length === due.length && list[list.length - 1]?.id === due[due.length - 1]?.id ? list : due.slice(-MAX_MESSAGES)))
    }, 500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [mode, info.isReplay, open, videoId])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async () => {
    const value = text.trim()
    if (!value || !sendParams) return
    setText('')
    try {
      await api.sendLiveChat(value, sendParams)
    } catch (failure) {
      toast('Không gửi được tin nhắn: ' + errorMessage(failure))
    }
  }

  return (
    <section className={'dp-chat' + (open ? '' : ' dp-chat--closed')} data-testid="live-chat">
      <div className="dp-panel-head">
        <div className="dp-panel-title">{info.isReplay ? 'Phát lại nội dung trò chuyện' : 'Trò chuyện trực tiếp'}</div>
        {info.modes.length > 1 && open ? (
          <select className="dp-select" value={modeIndex} onChange={(e) => setModeIndex(Number(e.target.value))} aria-label="Chế độ xem">
            {info.modes.map((m, i) => (
              <option key={m.continuation} value={i}>
                {m.title}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="dp-icon-button" aria-label={open ? 'Ẩn cuộc trò chuyện' : 'Hiện cuộc trò chuyện'} onClick={() => setOpen(!open)}>
          <PIcon name={open ? 'chevronUp' : 'chevronDown'} size={22} />
        </button>
      </div>
      {open ? (
        <>
          <div
            className="dp-chat-list"
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
            {messages.length ? messages.map((m) => <Message key={m.id} message={m} />) : <div className="dp-empty">{info.isReplay ? 'Tin nhắn sẽ hiện theo thời điểm của video.' : 'Chưa có tin nhắn.'}</div>}
          </div>
          {error ? <div className="dp-chat-error">{error}</div> : null}
          {!info.isReplay ? (
            signedIn && sendParams ? (
              <div className="dp-chat-send">
                <input className="dp-composer-input" value={text} placeholder="Trò chuyện…" maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} />
                <button type="button" className="dp-icon-button" aria-label="Gửi" disabled={!text.trim()} onClick={() => void send()}>
                  <PIcon name="send" size={20} />
                </button>
              </div>
            ) : (
              <div className="dp-chat-note">{signedIn ? 'Không thể gửi tin nhắn trong cuộc trò chuyện này' : 'Đăng nhập để tham gia trò chuyện'}</div>
            )
          ) : null}
        </>
      ) : null}
    </section>
  )
}
