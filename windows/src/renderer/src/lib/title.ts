// Window title per page ("Kênh đăng ký - DVDTube"). The watch page sets its own.

import { useEffect } from 'react'

export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} - DVDTube` : 'DVDTube'
  }, [title])
}
