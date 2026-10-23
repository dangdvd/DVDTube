# DVDTube — xem YouTube không quảng cáo trên iPhone

Ứng dụng iOS viết bằng SwiftUI, giao diện theo phong cách ứng dụng YouTube chính thức nhưng
**không có quảng cáo** và mở sẵn các tính năng của YouTube Premium: phát trong nền,
hình trong hình (PiP), tải video xem offline.

> DVDTube là dự án cá nhân, không chính thức, không liên kết với Google/YouTube.
> Không bắt buộc tài khoản Google: khi chưa đăng nhập, đăng ký kênh, nhật ký xem, danh sách phát… lưu trên máy.

## Tính năng

| Mục | Chi tiết |
| --- | --- |
| Không quảng cáo | Lấy thẳng luồng video (HLS) từ máy chủ YouTube nên không có quảng cáo trước/giữa video. |
| SponsorBlock | Tự bỏ qua đoạn nhà tài trợ, tự quảng cáo, nhắc đăng ký… do người làm video lồng vào (tùy chọn). |
| Phát trong nền | Tắt màn hình hoặc chuyển app vẫn nghe tiếp; điều khiển trên màn hình khóa / Control Center. |
| Hình trong hình | Tự bật PiP khi vuốt về màn hình chính, hoặc bấm nút PiP. |
| Tải xuống | Tải video (đến 1080p) thành tệp `.mp4`, xem offline, xem cả trong app **Tệp**. |
| Trang chủ | Gợi ý dựa trên nhật ký xem + video mới của kênh đăng ký + Shorts; chip Âm nhạc, Trò chơi, Trực tiếp, Podcast, Tin tức, Thể thao, Học tập, Phim. |
| Shorts | Vuốt dọc toàn màn hình, tự lặp, tải trước video kế tiếp, thích / bình luận / chia sẻ. |
| Kênh đăng ký | Đăng ký không cần tài khoản; nhập/xuất từ Google Takeout (`subscriptions.csv`). |
| Trang xem video | Mini player kéo xuống/lên, vuốt lên toàn màn hình, chạm đúp tua ±10 giây, xem trước khung hình khi kéo thanh tua, chương (chapters), chất lượng, tốc độ, phụ đề (kể cả tự dịch sang tiếng Việt), AirPlay, hàng đợi. |
| Điều khiển giống app gốc | Giữ màn hình để tua nhanh 2x, chụm hai ngón để phóng đầy màn hình, lặp lại video, hẹn giờ tắt (15 phút → hết video), tự phát video tiếp theo có đếm ngược 5 giây và nút bật/tắt. |
| Dưới video | Thích / Không thích, Chia sẻ (kể cả *chia sẻ tại thời điểm đang xem*), Lưu vào danh sách phát, Tải xuống, Bản chép lời (transcript) bấm để tua tới đoạn đó. |
| Bình luận | Xem bình luận, phản hồi, sắp xếp Hàng đầu / Mới nhất; viết bình luận và trả lời khi đã đăng nhập. |
| Thư viện | Nhật ký xem (tiếp tục từ chỗ đã dừng), Xem sau, Video đã thích, danh sách phát riêng. |
| Tìm kiếm | Gợi ý khi gõ, **tìm bằng giọng nói** (nút micro), lịch sử, bộ lọc (Video, Shorts, Kênh, Danh sách phát, Trực tiếp, Mới tải lên), dán link YouTube để mở thẳng. |
| Thông báo | Chuông thông báo của tài khoản YouTube (có số chưa đọc); tùy chọn báo trên màn hình khóa khi kênh đăng ký có video mới (*Cài đặt › Thông báo*). |

## Đăng nhập tài khoản Google (tùy chọn)

Vào tab **Bạn** (hoặc *Cài đặt*) → **Đăng nhập tài khoản Google**. Khi đã đăng nhập:

- Trang chủ hiển thị đề xuất của chính tài khoản YouTube; tab Kênh đăng ký lấy danh sách kênh và
  video mới từ tài khoản.
- Tab Bạn có Nhật ký xem, Xem sau, Video đã thích, Danh sách phát của tài khoản.
- Bấm Đăng ký / Thích / Không thích / Xem sau được ghi lên tài khoản; video bạn xem được thêm vào
  nhật ký YouTube (có thể tắt trong Cài đặt).
- Lưu video vào danh sách phát của tài khoản (hoặc tạo danh sách phát mới), viết bình luận, xem
  chuông thông báo.
- Video **vẫn phát qua trình phát không quảng cáo** của ứng dụng.

Cách hoạt động: bạn đăng nhập trên chính trang của Google (mật khẩu không đi qua ứng dụng). Ứng dụng
chỉ giữ lại *phiên YouTube* (cookie của youtube.com), lưu trong **Keychain** của máy, và chỉ gửi
chúng tới `youtube.com` — giống như trang web YouTube làm.

Nếu Google báo *"Trình duyệt hoặc ứng dụng này có thể không an toàn"*, dùng **Nhập cookie thủ
công** (menu ⋯ trên màn hình đăng nhập): đăng nhập youtube.com trên máy tính (cửa sổ ẩn danh), xuất
cookie bằng tiện ích *Get cookies.txt LOCALLY*, đóng cửa sổ ẩn danh rồi dán nội dung vào ứng dụng.

> ⚠️ Đây là ứng dụng không chính thức. Dùng tài khoản với ứng dụng bên thứ ba có rủi ro (Google có
> thể yêu cầu xác minh lại hoặc hạn chế tài khoản), nên cân nhắc dùng tài khoản phụ. Cookie cho
> toàn quyền truy cập phiên Google: không chia sẻ chúng với ai.

## Cài đặt lên iPhone

Có hai cách. iOS 17 trở lên.

### Cách 1 — Không cần máy Mac (tải IPA từ GitHub)

1. Vào tab **Actions** của repo → chọn lần chạy *Build iOS app* mới nhất (dấu tích xanh) →
   tải **DVDTube-unsigned-ipa** ở mục *Artifacts* rồi giải nén ra `DVDTube-unsigned.ipa`.
   Nếu đã tạo tag dạng `v1.0`, tệp IPA cũng có trong mục **Releases**.
2. Cài tệp IPA bằng một trong các công cụ sau (chúng tự ký lại bằng Apple ID của bạn):
   - [AltStore](https://altstore.io) hoặc [SideStore](https://sidestore.io)
   - [Sideloadly](https://sideloadly.io) (Windows/macOS)
   - TrollStore (nếu phiên bản iOS của bạn hỗ trợ — cài vĩnh viễn, không phải ký lại)
3. Với Apple ID miễn phí, ứng dụng hết hạn sau 7 ngày — AltStore/SideStore tự gia hạn.

### Cách 2 — Dùng Xcode trên máy Mac

1. Cài Xcode 16 trở lên, mở `DVDYoutube.xcodeproj`.
2. Chọn target **DVDYoutube** → *Signing & Capabilities* → chọn *Team* (Apple ID cá nhân) và đổi
   *Bundle Identifier* thành tên riêng, ví dụ `com.tenban.dvdtube`.
3. Cắm iPhone, chọn thiết bị và bấm **Run** (⌘R). Lần đầu cần bật *Developer Mode* trên iPhone
   và tin cậy nhà phát triển trong *Cài đặt › Cài đặt chung › Quản lý VPN & thiết bị*.

## Cách hoạt động

```
SwiftUI views ──► YouTubeService ──► InnerTube (API nội bộ của YouTube)
                                      ├─ WEB client      : tìm kiếm, trang chủ, kênh, bình luận…
                                      └─ visionOS client : luồng phát (HLS) — không cần PO token
PlayerManager (AVPlayer) ◄── HLS manifest ── Google Video
```

- **Không quảng cáo**: ứng dụng bỏ qua toàn bộ dữ liệu quảng cáo trong phản hồi và phát luồng HLS
  trực tiếp bằng `AVPlayer`. Nếu YouTube bắt chờ bằng đúng thời lượng quảng cáo đầu video (cơ chế
  mới của YouTube), ứng dụng hiển thị đếm ngược thay vì phát quảng cáo.
- **Dự phòng**: nếu HLS lỗi, ứng dụng thử luồng MP4 ghép sẵn, rồi ghép riêng hình + tiếng.
  Nếu YouTube từ chối hẳn luồng phát (thông báo *"Đăng nhập để xác nhận bạn không phải là robot"*,
  thường gặp khi IP mạng bị YouTube đánh dấu), ứng dụng chuyển sang **trình phát web** (trình
  nhúng chính thức của YouTube) và tự ẩn/bỏ qua quảng cáo trong đó. Có thể tắt trong *Cài đặt*.
- **Cập nhật không cần cài lại**: các thông số client (tên, phiên bản, User-Agent…) có thể sửa trong
  [`Config/remote-config.json`](Config/remote-config.json). Ứng dụng tải tệp này từ nhánh `main`
  mỗi lần mở, nên khi YouTube thay đổi chỉ cần sửa tệp JSON và đẩy lên GitHub.
  Có thể đổi URL cấu hình trong *Cài đặt › Nâng cao*.

## Cấu trúc mã nguồn

```
DVDYoutube/
├─ App/            Điểm vào ứng dụng, TabView, điều hướng
├─ Core/
│  ├─ InnerTube/   Client InnerTube + bộ phân tích phản hồi (video, kênh, bình luận, luồng phát)
│  ├─ Services/    API cấp cao, RSS kênh, SponsorBlock, phụ đề
│  └─ Storage/     Cài đặt, thư viện (đăng ký, nhật ký, danh sách phát), tải xuống
├─ Player/         AVPlayer, mini player, điều khiển, PiP, phát nền, trình phát Shorts
├─ Features/       Các màn hình: Trang chủ, Shorts, Kênh đăng ký, Bạn, Tìm kiếm, Kênh,
│                  Danh sách phát, Trang xem video, Cài đặt
├─ Components/     Thẻ video, ảnh có cache, danh sách phân trang…
└─ Resources/      Asset catalog (biểu tượng ứng dụng)
Config/            Info.plist và remote-config.json
```

Dự án dùng *thư mục đồng bộ* của Xcode 16: thêm tệp `.swift` mới vào `DVDYoutube/` là Xcode tự
nhận, không phải sửa `project.pbxproj`.

## Giới hạn

- Chưa hỗ trợ: chat trực tiếp (live chat), tải video lên, Chromecast, tài khoản thương hiệu (brand
  account) / nhiều tài khoản cùng lúc.
- Báo video mới chạy bằng *Làm mới ứng dụng trong nền* của iOS: iOS tự quyết định khi nào chạy
  (thường vài giờ một lần, ít hơn nếu ít mở ứng dụng hoặc đang ở Chế độ nguồn điện thấp).
- Video giới hạn độ tuổi, video "dành cho trẻ em" hoặc nội dung trả phí có thể không phát được.
- YouTube thay đổi API thường xuyên; khi có lỗi phát hàng loạt, hãy cập nhật `remote-config.json`
  hoặc mã nguồn.
- Chặn quảng cáo vi phạm Điều khoản dịch vụ của YouTube. Chỉ nên dùng cho mục đích cá nhân.
