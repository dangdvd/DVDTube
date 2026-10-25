# DVDTube cho LG webOS TV

Ứng dụng xem YouTube không quảng cáo trên TV LG chạy **webOS TV 5.0 trở lên** (Chromium 68 / Node.js 8.12 và mới
hơn), giao diện 10-foot 1920×1080, điều khiển bằng remote (phím mũi tên, OK, Back, phím màu, Play/Pause…) và Magic
Remote (con trỏ). Cùng tính năng và cách gọi với các bản iPhone, Android và Windows: trang chủ, Shorts, Nghe nhạc,
kênh đăng ký, thư viện, SponsorBlock, DeArrow, phụ đề, hẹn giờ tắt, kiểm soát của phụ huynh, **Đăng nhập bằng điện
thoại** (quét mã QR), **Truyền tới DVDTube** (TV là thiết bị nhận) và **Đồng bộ thư viện**.

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `app/` | Giao diện TV (Preact, TypeScript): `src/pages` các màn hình, `src/player` trình phát, `src/state` cài đặt / thư viện / phụ huynh / tài khoản (lưu trong `localStorage`, cùng định dạng với bản máy tính), `src/focus.ts` + `src/keys.ts` điều hướng bằng remote. |
| `service/` | Dịch vụ JS `com.dangdvd.dvdtube.service` (một tệp `service.js` cho Node.js 8.12+): truy cập YouTube bằng phần lõi InnerTube dùng chung của bản Windows (`windows/src/main/core`), proxy HLS, máy chủ API cục bộ `127.0.0.1:8770`, cổng nhận Truyền tới DVDTube (TCP 8766 + DNS-SD `_dvdtube._tcp`), máy chủ QR đăng nhập (TCP 8765) và đồng bộ thư viện (TCP 8768). |
| `scripts/` | Đóng gói (`build.mjs`, `package.mjs`), kiểm thử (`run-tests.mjs`, `smoke.mjs`), chụp màn hình (`shots.mjs`), tạo biểu tượng (`make-icons.py`). |
| `test/` | Kiểm thử `node:test`: playlist HLS, mã hóa URL proxy, fetcher cho Node, định tuyến API, các máy chủ cast / đồng bộ / đăng nhập, gói `dist/` và kiểm tra trên Node 8. |
| `tools/fake-modules/` | Mô-đun `webos-service` giả để chạy `service.js` ngoài TV (kiểm thử, smoke test). |
| `assets/` | Biểu tượng 80×80, 130×130 và màn hình chờ 1920×1080. |

Giao diện chỉ dùng luna (`PalmServiceBridge`) để khởi động dịch vụ và giữ nó chạy (`keepAlive`), mọi thứ khác đi qua
HTTP tới `127.0.0.1` kèm mã bí mật của mỗi lần chạy. Cookie tài khoản do giao diện lưu trên TV, dịch vụ chỉ giữ trong
bộ nhớ, không ghi log và chỉ gửi tới `*.youtube.com`.

## Lệnh

```bash
npm ci                     # cài công cụ (Node.js 18+ trên máy build)
npm run build              # dist/app (giao diện) + dist/service (service.js)
npm test                   # kiểm thử; OLD_NODE=/đường/dẫn/node-v8.12.0/bin/node npm test để chạy thêm trên Node 8
npx playwright install --with-deps chromium
npm run smoke              # dịch vụ thật + giao diện trong Chromium 1920×1080 → dist/smoke/ (ảnh + report.json)
npm run shots              # ảnh mọi màn hình ở chế độ mẫu → dist/shots/
APP_VERSION=1.0.5 npm run package   # → dist/DVDTube-webOS.ipk
```

**Chế độ mẫu:** mở `dist/app/index.html?mock=1` trong Chrome để xem giao diện với dữ liệu mẫu tiếng Việt, không cần
mạng (ngoài TV, khi không có `PalmServiceBridge`, ứng dụng tự dùng chế độ mẫu).

## Cài lên TV

1. Trên TV: cài ứng dụng **Developer Mode** từ LG Content Store, đăng nhập tài khoản LG Developer, bật *Dev Mode
   Status* và *Key Server*, khởi động lại TV.
2. Trên máy tính (cùng mạng với TV):

```bash
npx ares-setup-device      # thêm TV: tên "tv", địa chỉ IP của TV, cổng 9922, người dùng prisoner
npx ares-novacom --device tv --getkey    # nhập passphrase hiện trên TV
npx ares-install --device tv dist/DVDTube-webOS.ipk
npx ares-launch --device tv com.dangdvd.dvdtube
```

Gỡ cài đặt: `npx ares-install --device tv --remove com.dangdvd.dvdtube`. Xem log của dịch vụ:
`npx ares-log --device tv -f`. Bản cập nhật: *Cài đặt › Giới thiệu › Kiểm tra cập nhật* báo khi có bản mới trên
GitHub; tải `DVDTube-webOS.ipk` và cài lại bằng `ares-install` như trên (thư viện và cài đặt được giữ nguyên).

Mở thẳng một video khi khởi chạy: `npx ares-launch --device tv com.dangdvd.dvdtube --params '{"videoId":"jNQXAC9IVRw","t":30}'`.

TV cần cho phép các cổng trong mạng nội bộ: TCP 8765 (đăng nhập bằng điện thoại), 8766 (Truyền tới DVDTube), 8768
(đồng bộ thư viện) và UDP 5353 (tìm TV tự động); cổng 8770 chỉ mở trên `127.0.0.1`.
