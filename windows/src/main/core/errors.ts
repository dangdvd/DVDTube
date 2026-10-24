// Errors thrown by the core. Their messages are user-facing Vietnamese text (same wording as the
// mobile apps where it exists), so the IPC layer can pass them to the renderer unchanged.

export type CoreErrorKind =
  | 'http'
  | 'unplayable'
  | 'loginRequired'
  | 'noStreams'
  | 'invalidResponse'
  | 'network'
  | 'timeout'
  | 'signedOut'
  | 'cancelled'
  | 'other'

export class CoreError extends Error {
  constructor(
    message: string,
    readonly kind: CoreErrorKind,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CoreError'
  }
}

export const Errors = {
  http: (status: number) =>
    new CoreError(
      status === 429
        ? 'YouTube tạm thời giới hạn yêu cầu (429). Vui lòng thử lại sau.'
        : `Lỗi kết nối tới YouTube (HTTP ${status}).`,
      'http',
      status,
    ),
  unplayable: (reason: string) => new CoreError(reason, 'unplayable'),
  /** YouTube's "Sign in to confirm you're not a bot" (or age gate) on the player endpoint. */
  loginRequired: (reason: string) => new CoreError(reason, 'loginRequired'),
  noStreams: () => new CoreError('Không tìm thấy luồng phát cho video này.', 'noStreams'),
  invalidResponse: () => new CoreError('Phản hồi từ YouTube không hợp lệ.', 'invalidResponse'),
  network: () => new CoreError('Không thể kết nối tới YouTube. Kiểm tra mạng và thử lại.', 'network'),
  /** Same as `network` for hosts other than YouTube. */
  networkOther: () => new CoreError('Không có kết nối mạng. Kiểm tra mạng và thử lại.', 'network'),
  timeout: () => new CoreError('YouTube phản hồi quá chậm. Vui lòng thử lại.', 'timeout'),
  signedOut: () => new CoreError('Bạn cần đăng nhập tài khoản YouTube để dùng tính năng này.', 'signedOut'),
  cancelled: () => new CoreError('Đã hủy.', 'cancelled'),
}

export function isCoreError(error: unknown, kind?: CoreErrorKind): error is CoreError {
  return error instanceof CoreError && (kind === undefined || error.kind === kind)
}

/** The message of any error, for logs (never contains request headers or cookies). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
