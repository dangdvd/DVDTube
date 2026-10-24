// Comments: sort menu, infinite loading, replies, like / dislike / reply / post when signed
// in, pinned + creator + hearted badges, clickable timestamps.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Comment, CommentSortOption } from '@shared/models'
import { api, errorMessage } from '@/lib/api'
import { paths } from '@/lib/nav'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { PIcon } from '../ui/icons'
import { MenuItem, Popover, useMenu } from '../ui/Popover'
import { RichText } from './RichText'

export function useSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const callback = useRef(onVisible)
  callback.current = onVisible
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && callback.current(), { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled])
  return ref
}

function Avatar({ src, name, size }: { src?: string | null; name: string; size: number }) {
  return src ? (
    <img className="dp-avatar" src={src} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="dp-avatar dp-avatar--letter" style={{ width: size, height: size }}>
      {name.replace('@', '').charAt(0).toUpperCase()}
    </span>
  )
}

function Composer({ placeholder, submitLabel, onSubmit, onCancel, autoFocus }: { placeholder: string; submitLabel: string; onSubmit: (text: string) => Promise<void>; onCancel?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(!!autoFocus)
  const [busy, setBusy] = useState(false)
  const profile = useAccount((s) => s.profile)
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(text.trim())
      setText('')
      setFocused(false)
      onCancel?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dp-composer">
      <Avatar src={profile?.avatar} name={profile?.name ?? 'B'} size={autoFocus ? 24 : 40} />
      <div className="dp-composer-body">
        <input
          className="dp-composer-input"
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') {
              setFocused(false)
              onCancel?.()
            }
          }}
        />
        {focused ? (
          <div className="dp-composer-actions">
            <button
              type="button"
              className="dp-btn dp-btn--ghost"
              onClick={() => {
                setText('')
                setFocused(false)
                onCancel?.()
              }}
            >
              Hủy
            </button>
            <button type="button" className="dp-btn dp-btn--primary" disabled={!text.trim() || busy} onClick={() => void submit()}>
              {submitLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CommentView({ comment, onSeek, isReply }: { comment: Comment; onSeek?: (s: number) => void; isReply?: boolean }) {
  const signedIn = useAccount((s) => s.signedIn)
  const [state, setState] = useState(comment.likeState)
  const [expanded, setExpanded] = useState(false)
  const [replying, setReplying] = useState(false)
  const [replies, setReplies] = useState<Comment[] | null>(null)
  const [repliesToken, setRepliesToken] = useState<string | null>(comment.repliesToken ?? null)
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [loadingReplies, setLoadingReplies] = useState(false)
  const long = comment.text.length > 300 || comment.text.split('\n').length > 4

  const act = (kind: 'like' | 'dislike') => {
    if (!signedIn) {
      toast('Đăng nhập để thích bình luận')
      return
    }
    const current = state
    const next = kind === 'like' ? (current === 'LIKED' ? 'INDIFFERENT' : 'LIKED') : current === 'DISLIKED' ? 'INDIFFERENT' : 'DISLIKED'
    const token =
      kind === 'like' ? (current === 'LIKED' ? comment.unlikeToken : comment.likeToken) : current === 'DISLIKED' ? comment.undislikeToken : comment.dislikeToken
    if (!token) {
      toast('Không thể đánh giá bình luận này')
      return
    }
    setState(next)
    api.commentAction(token).catch((error) => {
      setState(current)
      toast(errorMessage(error))
    })
  }

  const loadReplies = async (token: string) => {
    setLoadingReplies(true)
    try {
      const { page } = await api.comments(token)
      setReplies((list) => [...(list ?? []), ...page.comments])
      setRepliesToken(page.continuation ?? null)
    } catch {
      toast('Không tải được phản hồi')
    } finally {
      setLoadingReplies(false)
    }
  }

  const likeText = state === 'LIKED' && comment.likeState !== 'LIKED' ? (comment.likeCountLikedText ?? comment.likeCountText) : comment.likeCountText

  return (
    <div className={'dp-comment' + (isReply ? ' dp-comment--reply' : '')}>
      {comment.authorChannelId ? (
        <Link to={paths.channel(comment.authorChannelId)}>
          <Avatar src={comment.authorAvatar} name={comment.authorName} size={isReply ? 24 : 40} />
        </Link>
      ) : (
        <Avatar src={comment.authorAvatar} name={comment.authorName} size={isReply ? 24 : 40} />
      )}
      <div className="dp-comment-body">
        {comment.isPinned ? (
          <div className="dp-comment-pinned">
            <PIcon name="pin" size={14} /> Đã ghim
          </div>
        ) : null}
        <div className="dp-comment-head">
          <span className={'dp-comment-author' + (comment.isCreator ? ' dp-comment-author--creator' : '')}>{comment.authorName}</span>
          <span className="dp-comment-time">{comment.publishedText}</span>
        </div>
        <div className={'dp-comment-text' + (expanded || !long ? '' : ' dp-comment-text--clamped')}>
          <RichText text={comment.text} onSeek={onSeek} />
        </div>
        {long ? (
          <button type="button" className="dp-text-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Ẩn bớt' : 'Đọc thêm'}
          </button>
        ) : null}
        <div className="dp-comment-actions">
          <button type="button" className={'dp-icon-text' + (state === 'LIKED' ? ' dp-icon-text--on' : '')} onClick={() => act('like')} aria-label="Thích">
            <PIcon name={state === 'LIKED' ? 'like' : 'likeOutline'} size={18} />
            {likeText && likeText !== '0' ? <span>{likeText}</span> : null}
          </button>
          <button type="button" className={'dp-icon-text' + (state === 'DISLIKED' ? ' dp-icon-text--on' : '')} onClick={() => act('dislike')} aria-label="Không thích">
            <PIcon name={state === 'DISLIKED' ? 'dislike' : 'dislikeOutline'} size={18} />
          </button>
          {comment.isHearted ? (
            <span className="dp-comment-heart" title="Được tim bởi tác giả">
              <PIcon name="heart" size={14} />
            </span>
          ) : null}
          {signedIn && comment.replyParams ? (
            <button type="button" className="dp-text-button dp-text-button--plain" onClick={() => setReplying(true)}>
              Phản hồi
            </button>
          ) : null}
        </div>
        {replying && comment.replyParams ? (
          <Composer
            placeholder="Thêm phản hồi…"
            submitLabel="Phản hồi"
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={async (text) => {
              try {
                const reply = await api.postReply(text, comment.replyParams!)
                if (reply) {
                  setReplies((list) => [reply, ...(list ?? [])])
                  setRepliesOpen(true)
                }
                toast('Đã gửi phản hồi')
              } catch (error) {
                toast('Không gửi được: ' + errorMessage(error))
                throw error
              }
            }}
          />
        ) : null}
        {comment.replyCountText && comment.repliesToken ? (
          <button
            type="button"
            className="dp-replies-toggle"
            onClick={() => {
              const open = !repliesOpen
              setRepliesOpen(open)
              if (open && replies == null && comment.repliesToken) void loadReplies(comment.repliesToken)
            }}
          >
            <PIcon name={repliesOpen ? 'chevronUp' : 'chevronDown'} size={20} />
            {comment.replyCountText} phản hồi
          </button>
        ) : null}
        {repliesOpen && replies ? (
          <div className="dp-replies">
            {replies.map((reply) => (
              <CommentView key={reply.id} comment={reply} onSeek={onSeek} isReply />
            ))}
            {repliesToken ? (
              <button type="button" className="dp-replies-toggle" disabled={loadingReplies} onClick={() => void loadReplies(repliesToken)}>
                <PIcon name="chevronDown" size={20} /> Hiện thêm phản hồi
              </button>
            ) : null}
          </div>
        ) : null}
        {repliesOpen && loadingReplies && !replies ? <div className="dp-loading-line">Đang tải…</div> : null}
      </div>
    </div>
  )
}

export function Comments({ token, countText, onSeek }: { token: string; countText?: string | null; onSeek?: (seconds: number) => void }) {
  const signedIn = useAccount((s) => s.signedIn)
  const [comments, setComments] = useState<Comment[]>([])
  const [continuation, setContinuation] = useState<string | null>(null)
  const [sortOptions, setSortOptions] = useState<CommentSortOption[]>([])
  const [sortToken, setSortToken] = useState(token)
  const [count, setCount] = useState<string | null>(countText ?? null)
  const [createParams, setCreateParams] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const sort = useMenu()

  const load = useCallback(async (pageToken: string, reset: boolean) => {
    const my = reset ? ++generation.current : generation.current
    setLoading(true)
    setError(null)
    try {
      const result = await api.comments(pageToken)
      if (my !== generation.current) return
      setComments((list) => (reset ? result.page.comments : [...list, ...result.page.comments]))
      setContinuation(result.page.continuation ?? null)
      if (result.page.countText) setCount(result.page.countText)
      if (result.page.createParams) setCreateParams(result.page.createParams)
      if (result.sortOptions.length) setSortOptions(result.sortOptions)
    } catch (failure) {
      if (my === generation.current) setError(errorMessage(failure) || 'Không tải được bình luận.')
    } finally {
      if (my === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setComments([])
    setContinuation(null)
    setSortOptions([])
    setSortToken(token)
    setCount(countText ?? null)
    setCreateParams(null)
    void load(token, true)
  }, [token, countText, load])

  const sentinel = useSentinel(() => {
    if (continuation && !loading) void load(continuation, false)
  }, !!continuation && !loading && !error)

  return (
    <section className="dp-comments" data-testid="watch-comments">
      <div className="dp-comments-head">
        <h2>{count ? `${count} bình luận` : 'Bình luận'}</h2>
        {sortOptions.length ? (
          <button type="button" className="dp-text-button dp-text-button--plain" onClick={sort.open}>
            <PIcon name="sort" size={22} /> Sắp xếp theo
          </button>
        ) : null}
      </div>
      {sort.anchor ? (
        <Popover anchor={sort.anchor} onClose={sort.close}>
          {sortOptions.map((option) => (
            <MenuItem
              key={option.token}
              label={option.title}
              checked={option.token === sortToken}
              onSelect={() => {
                sort.close()
                setSortToken(option.token)
                void load(option.token, true)
              }}
            />
          ))}
        </Popover>
      ) : null}
      {signedIn && createParams ? (
        <Composer
          placeholder="Viết bình luận…"
          submitLabel="Bình luận"
          onSubmit={async (text) => {
            try {
              const posted = await api.postComment(text, createParams)
              if (posted) setComments((list) => [posted, ...list])
              toast('Đã đăng bình luận')
            } catch (failure) {
              toast('Không gửi được: ' + errorMessage(failure))
              throw failure
            }
          }}
        />
      ) : null}
      {comments.map((comment) => (
        <CommentView key={comment.id} comment={comment} onSeek={onSeek} />
      ))}
      {!loading && !error && !comments.length ? <div className="dp-empty">Chưa có bình luận nào.</div> : null}
      {error ? (
        <div className="dp-empty">
          {error}{' '}
          <button type="button" className="dp-text-button" onClick={() => void load(continuation ?? sortToken, !continuation)}>
            Thử lại
          </button>
        </div>
      ) : null}
      {loading ? <div className="dp-loading-line">Đang tải bình luận…</div> : null}
      <div ref={sentinel} />
    </section>
  )
}
