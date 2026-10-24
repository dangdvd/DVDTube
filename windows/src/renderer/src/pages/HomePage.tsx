// Home: sticky category chips, "Tiếp tục xem" row, responsive grid with Shorts shelves and
// infinite scrolling.

import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { HomeCategory } from '@shared/models'
import { HOME_CATEGORIES } from '@shared/models'
import { ChipBar } from '@/components/Chips'
import { Shelf } from '@/components/Cards'
import { FeedView } from '@/components/FeedView'
import { Icon } from '@/components/Icon'
import { homeCategoryPath } from '@/components/shell/Sidebar'
import { VideoCard } from '@/components/VideoCard'
import { api } from '@/lib/api'
import { useFeed } from '@/lib/feed'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { useLibrary } from '@/state/library'
import { useSettings } from '@/state/settings'

function ContinueWatching() {
  const history = useLibrary((s) => s.history)
  const paused = useSettings((s) => s.settings.incognito)
  if (paused) return null
  const items = history
    .filter((h) => !h.video.isShort && !h.video.isLive && h.duration > 60 && h.position > 15 && h.position < h.duration - 20)
    .slice(0, 12)
  if (!items.length) return null
  return (
    <Shelf
      title="Tiếp tục xem"
      icon={<Icon name="history" size={24} />}
      action={
        <Link to={paths.history} className="btn btn-text btn-small">
          Xem tất cả
        </Link>
      }
      className="shelf--videos"
      testId="continue-watching"
    >
      {items.map((h) => (
        <div key={h.video.id} className="shelf-video">
          <VideoCard video={h.video} layout="grid" />
        </div>
      ))}
    </Shelf>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requested = params.get('c') as HomeCategory | null
  const category: HomeCategory = HOME_CATEGORIES.some((c) => c.id === requested) ? requested! : 'all'
  const feed = useFeed('home:' + category, () => api.home(category))
  usePageTitle(category === 'all' ? null : HOME_CATEGORIES.find((c) => c.id === category)?.title)

  return (
    <div className="page page--home" data-testid="home-page">
      <ChipBar
        sticky
        options={HOME_CATEGORIES}
        value={category}
        onChange={(c) => navigate(homeCategoryPath(c), { replace: true })}
        testId="home-chips"
      />
      <div className="page-pad">
        <FeedView
          feed={feed}
          layout="grid"
          testId="home-feed"
          header={category === 'all' ? <ContinueWatching /> : null}
          emptyTitle="YouTube chưa có đề xuất cho mục này"
          emptyIcon="home"
        />
      </div>
    </div>
  )
}
