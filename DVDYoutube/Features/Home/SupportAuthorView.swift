import Photos
import SwiftUI
import UIKit

/// The author's bank account for "Ủng hộ tác giả" (same as the VietQR in the DonateQR image).
enum Donation {
    static let accountName = "DANG VAN DANG"
    static let accountNumber = "19033516270019"
    static let bankName = "Techcombank"
    /// Bank code used by VietQR's deeplinks (`ba=<account>@<bank>`).
    static let bankCode = "tcb"
    static let transferNote = "Ung ho DVDTube"

    /// Bank apps VietQR's deeplink service can open with the recipient filled in
    /// (app ids of https://api.vietqr.io/v2/ios-app-deeplinks).
    static let bankApps: [BankApp] = [
        BankApp("vcb", "Vietcombank"), BankApp("mb", "MB Bank"), BankApp("tcb", "Techcombank"), BankApp("bidv", "BIDV"),
        BankApp("icb", "VietinBank"), BankApp("vba", "Agribank"), BankApp("acb", "ACB"), BankApp("vpb", "VPBank"),
        BankApp("tpb", "TPBank"), BankApp("stb", "Sacombank"), BankApp("vib", "VIB"), BankApp("hdb", "HDBank"),
        BankApp("shb", "SHB"), BankApp("ocb", "OCB"), BankApp("msb", "MSB"), BankApp("seab", "SeABank"),
        BankApp("lpb", "LPBank"), BankApp("eib", "Eximbank"), BankApp("cake", "Cake"), BankApp("timo", "Timo"),
    ]

    struct BankApp: Identifiable {
        let id: String
        let name: String

        init(_ id: String, _ name: String) {
            self.id = id
            self.name = name
        }
    }

    /// "1903 3516 2700 19", as printed under the QR code.
    static var formattedAccountNumber: String {
        stride(from: 0, to: accountNumber.count, by: 4).map { start in
            let from = accountNumber.index(accountNumber.startIndex, offsetBy: start)
            let to = accountNumber.index(from, offsetBy: 4, limitedBy: accountNumber.endIndex) ?? accountNumber.endIndex
            return String(accountNumber[from..<to])
        }.joined(separator: " ")
    }

    /// Opens the bank app with the transfer to the author filled in (the amount is left to the user).
    static func bankAppLink(_ appId: String) -> URL? {
        var components = URLComponents(string: "https://dl.vietqr.io/pay")
        components?.queryItems = [
            URLQueryItem(name: "app", value: appId),
            URLQueryItem(name: "ba", value: "\(accountNumber)@\(bankCode)"),
            URLQueryItem(name: "tn", value: transferNote),
            URLQueryItem(name: "bn", value: accountName),
        ]
        return components?.url
    }
}

/// "Ủng hộ tác giả": the author's VietQR, plus links that open a bank app on this phone
/// for people who have no second device to scan the code with.
struct SupportAuthorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var copied = false
    @State private var saveResult: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header
                    Image("DonateQR")
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 300)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                        .accessibilityLabel("Mã QR chuyển khoản VietQR tới \(Donation.accountName)")
                    Text("Quét mã bằng ứng dụng ngân hàng hoặc ví điện tử có hỗ trợ VietQR.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    accountCard
                    bankApps
                    saveToPhotos
                }
                .padding()
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Ủng hộ tác giả")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Xong") { dismiss() }
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image(systemName: "heart.fill")
                .font(.system(size: 40))
                .foregroundStyle(.red)
            Text("Cảm ơn bạn đã dùng DVDTube!")
                .font(.title3.bold())
                .multilineTextAlignment(.center)
            Text("DVDTube miễn phí và không có quảng cáo. Nếu thấy ứng dụng hữu ích, bạn có thể ủng hộ tác giả một ly cà phê để có thêm động lực duy trì và phát triển ứng dụng. Mọi sự ủng hộ, dù nhỏ, đều rất đáng quý.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            LabeledContent("Chủ tài khoản", value: Donation.accountName)
            LabeledContent("Ngân hàng", value: Donation.bankName)
            LabeledContent("Số tài khoản") {
                Text(Donation.formattedAccountNumber)
                    .monospacedDigit()
                    .textSelection(.enabled)
            }
            Button {
                UIPasteboard.general.string = Donation.accountNumber
                copied = true
                Task {
                    try? await Task.sleep(for: .seconds(2))
                    copied = false
                }
            } label: {
                Label(copied ? "Đã sao chép số tài khoản" : "Sao chép số tài khoản",
                      systemImage: copied ? "checkmark" : "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .font(.subheadline)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var bankApps: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Chuyển khoản ngay trên điện thoại này")
                .font(.headline)
            Text("Chọn ứng dụng ngân hàng bạn đang dùng: ứng dụng sẽ mở với người nhận và nội dung chuyển khoản điền sẵn, bạn chỉ cần nhập số tiền.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(Donation.bankApps) { app in
                    Button {
                        if let url = Donation.bankAppLink(app.id) { openURL(url) }
                    } label: {
                        Text(app.name)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Mở ứng dụng \(app.name)")
                }
            }
            Text("Vietcombank và một số ứng dụng chỉ mở ứng dụng mà chưa tự điền thông tin. Khi đó hãy lưu mã QR bên dưới rồi quét từ ảnh.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var saveToPhotos: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await saveQRCode() }
            } label: {
                Label("Lưu mã QR vào ảnh", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .disabled(saving)
            Text(saveResult ?? "Mở ứng dụng ngân hàng › Quét QR › chọn ảnh mã QR vừa lưu trong thư viện.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func saveQRCode() async {
        guard let image = UIImage(named: "DonateQR") else { return }
        saving = true
        defer { saving = false }
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            saveResult = "DVDTube chưa được phép thêm ảnh. Bật trong Cài đặt › DVDTube › Ảnh."
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }
            saveResult = "Đã lưu mã QR vào ảnh. Mở ứng dụng ngân hàng › Quét QR › chọn ảnh vừa lưu."
        } catch {
            saveResult = "Không lưu được ảnh: \(error.localizedDescription)"
        }
    }
}
