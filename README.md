# DVDTube — xem YouTube không quảng cáo trên iPhone, Android, TV và máy tính

Ứng dụng iOS (SwiftUI), Android (Kotlin + Jetpack Compose) và Windows (Electron) cùng tính năng, giao diện theo phong
cách ứng dụng YouTube chính thức nhưng **không có quảng cáo** và mở sẵn các tính năng của YouTube Premium: phát trong nền,
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
| Tải xuống | Tải video (đến 1080p) thành tệp `.mp4` hoặc **chỉ âm thanh** (`.m4a`) để nghe offline, **tải cả danh sách phát** bằng một lần bấm; xem cả trong app **Tệp**. |
| Trang chủ | Gợi ý dựa trên nhật ký xem + video mới của kênh đăng ký + Shorts; chip Âm nhạc, Trò chơi, Trực tiếp, Podcast, Tin tức, Thể thao, Học tập, Phim. |
| Shorts | Vuốt dọc toàn màn hình, tự lặp, tải trước video kế tiếp, thích / bình luận / chia sẻ. |
| Kênh đăng ký | Đăng ký không cần tài khoản; nhập/xuất từ Google Takeout (`subscriptions.csv`). |
| Trang xem video | Mini player kéo xuống/lên (trang đi theo ngón tay), vuốt lên toàn màn hình (video dọc giữ màn hình dọc, chỉ video ngang mới xoay ngang; nút xoay 90° theo/ngược chiều kim đồng hồ khi toàn màn hình), chạm đúp tua ±10 giây, xem trước khung hình khi kéo thanh tua, chương (chapters), chất lượng, tốc độ, phụ đề (kể cả tự dịch sang tiếng Việt), AirPlay, hàng đợi. |
| Điều khiển giống app gốc | Giữ màn hình để tua nhanh 2x, chụm hai ngón để phóng đầy màn hình, chạm hai lần để tua (5–60 giây, chỉnh được), tốc độ 0,25x–4x (kéo thanh trượt), lặp lại video, tự phát video tiếp theo có đếm ngược 5 giây, khóa màn hình (nút 🔒 ngay trên thanh điều khiển, chống chạm nhầm), thống kê chi tiết (độ phân giải, bitrate, bộ đệm…), cỡ chữ và nền phụ đề. |
| Hẹn giờ tắt | Nút 🌙 ngay dưới video và trong ⚙ trình phát: 5 phút → 2 giờ, khi hết video, hoặc tự chọn giờ/phút; hiện đồng hồ đếm ngược trên trình phát và mini player, thêm +5/+15/+30 phút, âm thanh nhỏ dần 10 giây cuối rồi dừng (chạy cả khi phát nền/khóa máy). |
| Chỉ phát âm thanh | Nút 🎧 trên trình phát / dưới video: không tải hình, chỉ tải luồng âm thanh (~1 MB/phút, ~0,4 MB/phút khi tiết kiệm dữ liệu) — nghe nhạc, podcast bằng 4G rất tiết kiệm; tùy chọn tự bật khi dùng dữ liệu di động. |
| Tiết kiệm dữ liệu | Khi dùng 4G/5G: video tối đa 360p, ảnh thu nhỏ cỡ nhỏ, không tải trước Shorts; tùy chọn chỉ tải xuống qua Wi-Fi. |
| Sức khỏe số | Nhắc nghỉ giải lao sau mỗi 15 phút → 3 giờ xem, nhắc giờ đi ngủ (khung giờ tự đặt, nhắc lại sau 10 phút), thống kê thời gian xem (hôm nay, hôm qua, 7 ngày, trung bình/ngày). |
| Ẩn danh & đề xuất | Chế độ ẩn danh (không lưu nhật ký xem/tìm kiếm); menu ⋮ của video có *Phát tiếp theo*, *Không quan tâm*, *Không đề xuất kênh này* (quản lý trong *Cài đặt › Nội dung đã ẩn*). |
| Dưới video | Thích / Không thích, Chia sẻ (kể cả *chia sẻ tại thời điểm đang xem*), Lưu vào danh sách phát, Tải xuống, Bản chép lời (transcript) bấm để tua tới đoạn đó. |
| Bình luận | Xem bình luận, phản hồi, sắp xếp Hàng đầu / Mới nhất; viết bình luận và trả lời khi đã đăng nhập. |
| Trò chuyện trực tiếp | Live chat của buổi phát trực tiếp (Hàng đầu / Tất cả, Super Chat, hội viên), gửi tin nhắn khi đã đăng nhập; video đã phát trực tiếp có *phát lại nội dung trò chuyện* chạy theo thời gian video. |
| Chromecast | Nút 📺 trên trình phát: tìm Chromecast / Google TV trong mạng Wi-Fi và phát luồng không quảng cáo trên TV; điện thoại thành điều khiển (phát/tạm dừng/tua/âm lượng, tự phát video tiếp theo). |
| Thư viện | Nhật ký xem (tiếp tục từ chỗ đã dừng), Xem sau, Video đã thích, danh sách phát riêng. |
| Tìm kiếm | Gợi ý khi gõ, **tìm bằng giọng nói** (nút micro), lịch sử, bộ lọc (Video, Shorts, Kênh, Danh sách phát, Trực tiếp, Mới tải lên), dán link YouTube để mở thẳng. |
| Bộ chỉnh âm (EQ) | EQ 10 băng tần (31 Hz → 16 kHz, ±12 dB) với các thiết lập sẵn: Pop, Rock, EDM, Dance, Trap, Hip-hop, R&B, Cổ điển, Jazz, Acoustic, Bolero – Trữ tình, K-pop, Electronic, Metal, Lofi, Latin, Piano, Giọng hát, Lời nói – Podcast, Tăng bass, Tăng treble, Loudness, Loa điện thoại; chỉnh tay từng băng (lưu thành *Tùy chỉnh*), tiền khuếch đại tự động chống rè. Mở trong ⚙ trình phát hoặc *Cài đặt › Âm thanh*. Trên iPhone, khi bật EQ ứng dụng phát luồng MP4 thay cho HLS (video trực tiếp không áp dụng EQ). |
| Âm thanh | Chọn **bản âm thanh** (ngôn ngữ lồng tiếng) cho video có nhiều ngôn ngữ, **âm lượng ổn định** (cân bằng độ to giữa các video). |
| Phát lại nhiều nhất | Biểu đồ "phát lại nhiều nhất" trên thanh tua và nút **Tua tới đoạn hay**. |
| Chế độ môi trường | Ở giao diện tối, màu của khung hình đang phát toả nhẹ ra quanh trình phát như app gốc. |
| Vuốt chỉnh độ sáng / âm lượng | Khi toàn màn hình: vuốt dọc ở mép trái để chỉnh độ sáng, mép phải để chỉnh âm lượng; thanh mức hiện ngay trong lúc vuốt (tắt được trong Cài đặt). |
| Kênh | Tab **Bài đăng** (cộng đồng: chữ, ảnh, video, bình chọn), tab **Giới thiệu** (mô tả, liên kết, ngày tham gia, số lượt xem) và **tìm kiếm trong kênh**. |
| Bộ lọc tìm kiếm | Ngày tải lên, loại, thời lượng, tính năng (Trực tiếp, 4K, HD, Phụ đề, 360°, HDR…), sắp xếp theo lượt xem / ngày tải lên / xếp hạng. |
| Bình luận & đánh giá | Thích / không thích bình luận khi đã đăng nhập; hiện **số lượt không thích** của video (dữ liệu Return YouTube Dislike, tắt được). |
| Nhật ký | Tạm dừng nhật ký xem, tạm dừng / xóa nhật ký tìm kiếm. |
| Thông báo | Chuông thông báo của tài khoản YouTube (có số chưa đọc); tùy chọn báo trên màn hình khóa khi kênh đăng ký có video mới (*Cài đặt › Thông báo*). |
| Truyền tới DVDTube trên TV / máy tính | Nút truyền liệt kê DVDTube trên Android TV và máy tính trong cùng Wi-Fi (thêm được bằng địa chỉ IP); TV tự lấy luồng phát (chất lượng tới 4K, không cần Chromecast), điện thoại thành điều khiển: phát/tạm dừng, tua, ±10 giây, âm lượng, hàng đợi, *Tiếp tục trên thiết bị này*. |
| Đồng bộ & sao lưu | *Cài đặt › Đồng bộ & sao lưu*: gộp kênh đăng ký, nhật ký xem (kèm vị trí đang xem), Xem sau, video đã thích, danh sách phát giữa iPhone, Android, TV và máy tính bằng mã QR qua Wi-Fi (mã hoá), hoặc xuất/nhập tệp `.json`. |
| Nghe nhạc & lời bài hát | Mục **Nghe nhạc** (dữ liệu YouTube Music): tìm bài hát, video, album, nghệ sĩ, danh sách phát; màn hình đang phát với ảnh bìa lớn, **lời bài hát** chạy theo nhạc (karaoke khi có lời theo thời gian), *Radio từ bài này*, trộn bài, lặp lại; mặc định chỉ tải âm thanh, bài sau nối liền. Nút *Lời bài hát* cũng có ở trang xem video. |
| Tự động tải | Chọn kênh đăng ký để tự tải video mới (giữ tối đa N video mỗi kênh, chỉ qua Wi-Fi, có thể chỉ tải âm thanh). Bản máy tính tải được tới **4K** (AV1/VP9) và tải kèm **phụ đề .srt**. |
| DeArrow | Thay tiêu đề và ảnh thu nhỏ "giật tít" bằng bản do cộng đồng sửa (dữ liệu DeArrow); nhấn giữ để xem tiêu đề gốc; tắt được. |
| Kiểm soát của phụ huynh | Khóa bằng mã PIN: chế độ hạn chế của YouTube, giới hạn thời gian xem mỗi ngày, khung giờ được xem, chặn từ khoá / kênh, ẩn bình luận, ẩn Shorts, tắt tìm kiếm. |
| Màn hình chính | Widget *Tiếp tục xem* / *Video mới* trên iPhone và Android, hàng **Xem tiếp** trên màn hình chính Android TV, Jump List trên thanh tác vụ Windows. |
| Cập nhật | Tự kiểm tra bản mới: Android và Windows tải và cài bản mới ngay trong ứng dụng (giữ nguyên dữ liệu); iPhone báo và mở trang tải. |
| Nhật ký lỗi | *Cài đặt › Giới thiệu › Gửi nhật ký lỗi*: tạo tệp nhật ký đã xoá thông tin đăng nhập để gửi khi cần sửa lỗi. |
| Hàng đợi & hẹn giờ phát | Mở lại ứng dụng là thấy video/hàng đợi đang nghe dở trong mini player; **Hẹn giờ phát** (báo thức bằng nhạc: một lần, hằng ngày, ngày thường, cuối tuần) với danh sách phát, Xem sau, Radio…, âm lượng tăng dần. |

## Đăng nhập tài khoản Google (tùy chọn)

Vào tab **Bạn** (hoặc *Cài đặt*) → **Đăng nhập tài khoản Google**. Khi đã đăng nhập:

- Trang chủ hiển thị đề xuất của chính tài khoản YouTube; tab Kênh đăng ký lấy danh sách kênh và
  video mới từ tài khoản.
- Tab Bạn có Nhật ký xem, Xem sau, Video đã thích, Danh sách phát của tài khoản.
- Bấm Đăng ký / Thích / Không thích / Xem sau được ghi lên tài khoản; video bạn xem được thêm vào
  nhật ký YouTube (có thể tắt trong Cài đặt).
- Lưu video vào danh sách phát của tài khoản (hoặc tạo danh sách phát mới), viết bình luận, trò
  chuyện trong live chat, xem chuông thông báo.
- **Nhiều tài khoản và tài khoản thương hiệu**: bấm vào tên/ảnh đại diện ở tab Bạn → *Chuyển đổi tài
  khoản* để chọn tài khoản Google hoặc kênh (brand account); *Thêm tài khoản* để đăng nhập thêm.
- **Tải video lên**: nút ⊞ ở Trang chủ (hoặc menu ⋯ ở tab Bạn) → chọn video từ Ảnh/Tệp, nhập tiêu
  đề, mô tả, chế độ hiển thị. Có thêm lựa chọn *Tải lên bằng YouTube Studio (web)*.
- Video **vẫn phát qua trình phát không quảng cáo** của ứng dụng.

Cách hoạt động: bạn đăng nhập trên chính trang của Google (mật khẩu không đi qua ứng dụng). Ứng dụng
chỉ giữ lại *phiên YouTube* (cookie của youtube.com), lưu trong **Keychain** của máy, và chỉ gửi
chúng tới `youtube.com` — giống như trang web YouTube làm. Ngoại lệ duy nhất: khi bạn quét mã QR *Đăng nhập
bằng điện thoại* của DVDTube trên TV nhà mình và bấm *Gửi*, phiên được mã hoá rồi gửi tới TV đó qua mạng nội bộ.

Nếu Google báo *"Trình duyệt hoặc ứng dụng này có thể không an toàn"*, dùng **Nhập cookie thủ
công** (menu ⋯ trên màn hình đăng nhập): đăng nhập youtube.com trên máy tính (cửa sổ ẩn danh), xuất
cookie bằng tiện ích *Get cookies.txt LOCALLY*, đóng cửa sổ ẩn danh rồi dán nội dung vào ứng dụng.

> ⚠️ Đây là ứng dụng không chính thức. Dùng tài khoản với ứng dụng bên thứ ba có rủi ro (Google có
> thể yêu cầu xác minh lại hoặc hạn chế tài khoản), nên cân nhắc dùng tài khoản phụ. Cookie cho
> toàn quyền truy cập phiên Google: không chia sẻ chúng với ai.

## Cài đặt lên iPhone

Có hai cách. iOS 17 trở lên.

### Cách 1 — Không cần máy Mac (tải IPA từ GitHub)

1. Vào tab **Actions** của repo → chọn lần chạy *Build apps* mới nhất (dấu tích xanh) →
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

## Cài đặt lên Android

Android 8.0 trở lên. Mỗi lần build, GitHub Actions tạo cả tệp IPA (iPhone) và tệp APK (Android).

1. Vào tab **Actions** của repo → chọn lần chạy *Build apps* mới nhất (dấu tích xanh) → tải
   **DVDTube-apk** ở mục *Artifacts*, giải nén ra `DVDTube.apk` (nếu đã tạo tag `v…`, tệp APK cũng
   có trong mục **Releases**).
2. Mở tệp APK trên điện thoại, cho phép *Cài ứng dụng không rõ nguồn gốc* cho trình duyệt / trình
   quản lý tệp khi được hỏi, rồi bấm **Cài đặt**.
3. Không hết hạn, không cần ký lại. Các bản sau ký bằng cùng khóa nên cài đè lên bản cũ, giữ nguyên
   dữ liệu (đăng ký kênh, nhật ký, tải xuống…).

Bản Android có đầy đủ các tính năng ở bảng trên: phát trong nền với điều khiển trên thông báo và màn
hình khóa (vuốt đóng ứng dụng khỏi danh sách gần đây thì dừng phát), hình trong hình (tự bật khi về màn hình chính), xoay ngang để xem toàn màn hình, Chromecast
(qua Google Cast có sẵn trong Google Play services), đăng nhập Google, nhiều tài khoản/kênh thương
hiệu, tải video lên, live chat, thông báo video mới (WorkManager, khoảng mỗi giờ), mở link YouTube
được chia sẻ từ ứng dụng khác.

### Android TV / Google TV

Dùng **chính tệp `DVDTube.apk`** ở trên: cài lên TV (Android 8.0 trở lên) là ứng dụng hiện giao diện riêng cho
TV, điều khiển bằng remote, và có biểu tượng trên màn hình chính của TV.

1. Cách nhanh nhất: cài ứng dụng *Downloader* (AFTVnews) từ Google Play trên TV, nhập địa chỉ
   `https://github.com/dangdvd/DVDTube/releases/latest/download/DVDTube.apk` (luôn là bản phát hành mới
   nhất) rồi bấm *Cài đặt*. Hoặc chép `DVDTube.apk` vào USB và mở bằng trình quản lý tệp trên TV. Cho
   phép *Cài ứng dụng không rõ nguồn gốc* khi được hỏi.
2. Menu bên trái: Tìm kiếm (có tìm bằng giọng nói), Trang chủ, Shorts, Kênh đăng ký, Thư viện, Tài khoản, Cài đặt.
3. Khi xem: **OK** phát/tạm dừng, **◀ ▶** tua 10 giây (giữ để tua nhanh), **▲** hiện nút điều khiển (phụ đề,
   chất lượng, tốc độ, chỉ âm thanh, bản âm thanh, EQ, hẹn giờ tắt, thích, đăng ký…), **▼** video tiếp theo.
4. **Đăng nhập bằng điện thoại**: *Tài khoản › Đăng nhập bằng điện thoại* hiện mã QR — quét bằng Camera trên
   iPhone (hoặc *Bạn › Đăng nhập cho TV* trong DVDTube trên Android), xác nhận trên điện thoại là TV đăng nhập.
   Điện thoại và TV phải cùng mạng Wi-Fi. Phiên đăng nhập chỉ được gửi tới địa chỉ trong mạng nội bộ ghi
   trong mã QR, đã mã hoá bằng khoá chỉ có trong mã đó. Cũng có thể *Đăng nhập trên TV* bằng trang của Google.

### Android Auto (nghe trong xe)

Cắm điện thoại vào xe (hoặc kết nối Android Auto không dây): DVDTube hiện trong mục ứng dụng nghe
nhạc của Android Auto với các mục *Tiếp tục xem*, *Xem sau*, *Video đã thích*, *Danh sách phát*,
*Kênh đăng ký – video mới*, *Đã tải xuống*; chọn video để nghe âm thanh qua loa xe.

Vì DVDTube không cài từ Google Play, cần bật một lần: mở ứng dụng **Android Auto** trên điện thoại →
*Cài đặt* → chạm 10 lần vào *Phiên bản* để bật chế độ nhà phát triển → menu ⋮ → *Cài đặt cho nhà phát
triển* → bật **Nguồn không xác định** (Unknown sources). Sau đó vào *Tùy chỉnh trình chạy* của
Android Auto nếu DVDTube chưa hiện.

## Cài đặt lên Windows

Windows 10 / 11 (64-bit). Tải **bộ cài** bản mới nhất:
**https://github.com/dangdvd/DVDTube/releases/latest/download/DVDTube-Setup.exe**
(hoặc `DVDTube-Windows-portable.zip` trong mục **Releases**: giải nén rồi chạy `DVDTube.exe`, không cần cài).

1. Mở `DVDTube-Setup.exe`. Vì bộ cài chưa ký số, Windows SmartScreen có thể báo *"Windows đã bảo vệ
   PC của bạn"*: bấm **Thông tin bổ sung** → **Vẫn chạy**.
2. Chọn thư mục cài (mặc định trong tài khoản người dùng, không cần quyền quản trị) → **Cài đặt**.
   Bộ cài tạo lối tắt trên Desktop và Start menu; bản sau cài đè lên, giữ nguyên dữ liệu.

Bản Windows có các tính năng như bản điện thoại, giao diện theo YouTube trên máy tính: trang chủ theo
chủ đề, tìm kiếm có bộ lọc, kênh, danh sách phát, Shorts, kênh đăng ký, nhật ký xem, Xem sau, tải video /
âm thanh về máy (MP4 / M4A), đăng nhập Google (nhiều tài khoản, kênh thương hiệu) hoặc **đăng nhập
bằng điện thoại** (quét mã QR bằng DVDTube trên điện thoại, như Android TV). Trình phát hỗ trợ tới
4K/8K (VP9, AV1, H.264), chế độ rạp hát, toàn màn hình, trình phát mini khi duyệt trang khác, hình
trong hình, phụ đề (tự dịch), bản âm thanh lồng tiếng, SponsorBlock, bộ chỉnh âm 10 băng tần với các
mẫu Rock, Pop, EDM, Dance, Trap, Cổ điển, Jazz…, âm lượng ổn định, hẹn giờ tắt, phím media và nút
⏮ ⏯ ⏭ trên thanh tác vụ, thu nhỏ xuống khay hệ thống, thông báo video mới của kênh đăng ký.

Phím tắt giống YouTube: `Space`/`K` phát–tạm dừng (giữ `Space` để tua nhanh 2x), `J`/`L` lùi/tới 10 giây,
`←`/`→` lùi/tới, `↑`/`↓` âm lượng, `M` tắt tiếng, `F` toàn màn hình, `T` rạp hát, `I` trình phát mini,
`C` phụ đề, `Shift`+`<`/`>` tốc độ, `0`–`9` nhảy tới 0–90 %, `Shift`+`N`/`P` video tiếp theo / trước,
`Ctrl`+`K` hoặc `/` tìm kiếm, dán (`Ctrl`+`V`) một link YouTube ở bất kỳ đâu để mở ngay.

### macOS và Linux

Cùng mã nguồn với bản Windows, có trong mục **Releases**:
- **macOS** (11 trở lên): `DVDTube-mac-arm64.dmg` cho Mac chip Apple (M1…), `DVDTube-mac-x64.dmg` cho Mac Intel.
  Ứng dụng chưa ký số: lần đầu mở, nhấn chuột phải (hoặc Control + bấm) vào DVDTube trong *Ứng dụng* → **Mở** → **Mở**
  (hoặc *Cài đặt hệ thống › Quyền riêng tư & Bảo mật* → **Vẫn mở**).
- **Linux** (x86-64): `DVDTube-linux-x86_64.AppImage` (cho quyền chạy: `chmod +x`, rồi mở) hoặc
  `DVDTube-linux-amd64.deb` (`sudo apt install ./DVDTube-linux-amd64.deb`).

## Cài đặt lên TV LG (webOS)

TV LG chạy **webOS 5.0 trở lên** (đa số TV LG từ 2020). Tệp cài: `DVDTube-webOS.ipk` trong mục **Releases**
(tải thẳng: https://github.com/dangdvd/DVDTube/releases/latest/download/DVDTube-webOS.ipk).
LG chỉ cho cài ứng dụng ngoài kho bằng **chế độ nhà phát triển (Developer Mode)**:

1. Tạo tài khoản LG Developer miễn phí tại https://webostv.developer.lge.com (mục *Sign up*).
2. Trên TV: mở **LG Content Store**, tìm và cài ứng dụng **Developer Mode**. Mở ứng dụng, đăng nhập tài
   khoản vừa tạo, bật **Dev Mode Status** — TV sẽ khởi động lại.
3. Mở lại **Developer Mode**, bật **Key Server**, ghi lại **địa chỉ IP** của TV và **Passphrase** (6 ký tự).
4. Trên máy tính (Windows / macOS / Linux) cùng mạng Wi-Fi với TV: cài **webOS Dev Manager**
   (https://github.com/webosbrew/dev-manager-desktop/releases), chọn *Add device* → nhập IP của TV, chọn
   *Developer Mode*, nhập Passphrase.
5. Trong Dev Manager: **Apps** → **Install** → chọn tệp `DVDTube-webOS.ipk`. DVDTube xuất hiện trong danh
   sách ứng dụng của TV (nhấn nút Home trên điều khiển).

Lưu ý:
- Chế độ nhà phát triển có **thời hạn** (số giờ còn lại hiện trong ứng dụng Developer Mode). Hãy bấm
  **Extend** trước khi hết hạn (Dev Manager cũng gia hạn được); nếu để hết hạn, TV sẽ gỡ các ứng dụng đã cài
  theo cách này và phải cài lại. TV đã cài *Homebrew Channel* (root) thì không bị giới hạn này — cài tệp ipk
  qua Homebrew Channel.
- Đăng nhập: *Tài khoản* → **Đăng nhập bằng điện thoại**, quét mã QR bằng DVDTube trên iPhone/Android.
- Truyền video: trên điện thoại bấm nút **Truyền** và chọn TV LG (DVDTube phải đang mở trên TV).
- Điều khiển bằng các phím mũi tên / OK / Back hoặc con trỏ của Magic Remote; phím ⏯ ⏪ ⏩ để phát và tua.
- Cập nhật: *Cài đặt › Giới thiệu › Kiểm tra cập nhật* báo khi có bản mới; cài bản mới bằng Dev Manager như
  bước 5 (dữ liệu trong ứng dụng được giữ nguyên).

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
android/           Ứng dụng Android (Gradle): cùng cấu trúc core/ (InnerTube, dịch vụ, lưu trữ),
                   player/ (Media3 ExoPlayer, MediaSession), cast/ (Google Cast + relay), ui/ (Compose)
windows/           Ứng dụng Windows (Electron + React + TypeScript): src/main (InnerTube, tài khoản,
                   tải xuống, cửa sổ), src/renderer (giao diện, trình phát shaka-player DASH/HLS)
webos/             Ứng dụng TV LG webOS: app/ (giao diện TV, Preact) + service/ (dịch vụ Node chạy trên
                   TV: InnerTube dùng chung với bản máy tính, proxy HLS, nhận truyền video, đăng nhập QR)
```

Bản Android dùng Media3 ExoPlayer thay cho AVPlayer, WebView cho trình phát web dự phòng và đăng
nhập, Google Cast SDK cho Chromecast. Build bằng `cd android && ./gradlew assembleRelease`
(JDK 17, Android SDK 35).

Bản Windows dựng luồng DASH (VP9/AV1/H.264 + AAC/Opus) từ phản hồi InnerTube và phát bằng
shaka-player trong Chromium của Electron; build bằng `cd windows && npm ci && npm run dist:win`
(Node 22, chạy trên Windows) — CI tạo bộ cài NSIS và bản zip.

Dự án iOS dùng *thư mục đồng bộ* của Xcode 16: thêm tệp `.swift` mới vào `DVDYoutube/` là Xcode tự
nhận, không phải sửa `project.pbxproj`.

## Giới hạn

- Chromecast phát luồng HLS (tự lùi về MP4 360p nếu TV không phát được HLS). Luồng YouTube gắn với địa
  chỉ IP: iPhone và TV cần ra Internet qua cùng một mạng. Khi ứng dụng bị iOS tạm dừng ở nền, TV vẫn
  phát tiếp và ứng dụng tự kết nối lại khi mở lên.
- Tải video lên chạy khi ứng dụng đang mở; video dài/tệp lớn nên giữ màn hình sáng cho tới khi xong.
- Báo video mới chạy bằng *Làm mới ứng dụng trong nền* của iOS: iOS tự quyết định khi nào chạy
  (thường vài giờ một lần, ít hơn nếu ít mở ứng dụng hoặc đang ở Chế độ nguồn điện thấp).
- Video giới hạn độ tuổi, video "dành cho trẻ em" hoặc nội dung trả phí có thể không phát được.
- Với địa chỉ IP bị YouTube đánh dấu (VPN, máy chủ, mạng công ty…), YouTube có thể từ chối luồng
  phát với thông báo *"Đăng nhập để xác nhận bạn không phải là robot"*. Khi đó hãy đăng nhập tài khoản
  Google trong ứng dụng (ứng dụng tự chuyển sang luồng phát của tài khoản) hoặc tắt VPN.
- Bộ cài Windows chưa ký số nên SmartScreen cảnh báo ở lần chạy đầu (xem *Cài đặt lên Windows*).
- YouTube thay đổi API thường xuyên; khi có lỗi phát hàng loạt, hãy cập nhật `remote-config.json`
  hoặc mã nguồn.
- Chặn quảng cáo vi phạm Điều khoản dịch vụ của YouTube. Chỉ nên dùng cho mục đích cá nhân.
