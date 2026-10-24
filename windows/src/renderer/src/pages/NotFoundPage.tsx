import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/States'
import { paths } from '@/lib/nav'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="page page-pad">
      <EmptyState
        icon="alert"
        title="Trang này không tồn tại"
        message="Đường liên kết có thể đã hỏng hoặc trang đã bị xóa."
        action={
          <button className="btn btn-primary" onClick={() => navigate(paths.home)}>
            Về Trang chủ
          </button>
        }
      />
    </div>
  )
}
