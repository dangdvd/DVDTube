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

    /// Bank apps VietQR's deeplink service opens with the recipient, name and note filled in.
    static let autofillApps: [BankApp] = [
        BankApp("mb", "MB Bank"), BankApp("bidv", "BIDV"), BankApp("icb", "VietinBank"),
        BankApp("acb", "ACB"), BankApp("ocb", "OCB"),
    ]

    /// Bank apps the deeplink only opens: they accept no transfer details from other apps,
    /// so the account number is copied and the QR saved to Photos before opening them.
    static let otherApps: [BankApp] = [
        BankApp("vcb", "Vietcombank"), BankApp("tcb", "Techcombank"), BankApp("vba", "Agribank"),
        BankApp("vpb", "VPBank"), BankApp("tpb", "TPBank"), BankApp("stb", "Sacombank"),
        BankApp("vib-2", "VIB"), BankApp("hdb", "HDBank"), BankApp("shb", "SHB"),
        BankApp("msb", "MSB"), BankApp("seab", "SeABank"), BankApp("lpb", "LPBank"),
        BankApp("eib", "Eximbank"), BankApp("cake", "Cake"), BankApp("timo", "Timo"),
    ]

    /// App ids of https://api.vietqr.io/v2/ios-app-deeplinks.
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
    @State private var qrSaved = false
    /// A bank app that can't be filled in: the steps are shown before leaving for it.
    @State private var guideApp: Donation.BankApp?

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
            .alert(
                guideApp.map { "Mở \($0.name)" } ?? "",
                isPresented: Binding(get: { guideApp != nil }, set: { if !$0 { guideApp = nil } }),
                presenting: guideApp
            ) { app in
                Button("Mở \(app.name)") {
                    Task { await prepareAndOpen(app) }
                }
                Button("Hủy", role: .cancel) {}
            } message: { app in
                Text("\(app.name) chưa cho phép ứng dụng khác điền sẵn người nhận. DVDTube sẽ sao chép số tài khoản và lưu mã QR vào ảnh, rồi mở \(app.name). Trong ứng dụng, chọn một cách:\n\n• Quét QR › biểu tượng ảnh › chọn ảnh mã QR vừa lưu (nhanh nhất)\n• Chuyển tiền › dán số tài khoản \(Donation.formattedAccountNumber), ngân hàng \(Donation.bankName)")
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
            Text("Chọn ứng dụng ngân hàng bạn đang dùng.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Label("Tự điền sẵn người nhận", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.top, 4)
            bankGrid(Donation.autofillApps)
            Text("Ứng dụng mở ra với số tài khoản, tên người nhận và nội dung đã điền sẵn, bạn chỉ cần nhập số tiền.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Label("Ngân hàng khác", systemImage: "doc.on.clipboard")
                .font(.subheadline.weight(.semibold))
                .padding(.top, 8)
            bankGrid(Donation.otherApps)
            Text("Các ứng dụng này không cho ứng dụng khác điền sẵn người nhận. DVDTube sao chép số tài khoản và lưu mã QR vào ảnh trước khi mở, để bạn dán số tài khoản hoặc quét QR từ ảnh.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func bankGrid(_ apps: [Donation.BankApp]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(apps) { app in
                Button {
                    // Also handy when an app fills in less than asked: the number is ready to paste.
                    UIPasteboard.general.string = Donation.accountNumber
                    if Donation.autofillApps.contains(where: { $0.id == app.id }) {
                        openBankApp(app)
                    } else {
                        guideApp = app
                    }
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
    }

    private func openBankApp(_ app: Donation.BankApp) {
        if let url = Donation.bankAppLink(app.id) { openURL(url) }
    }

    /// Copies the account number and saves the QR (once) before opening an app that can't be filled in.
    private func prepareAndOpen(_ app: Donation.BankApp) async {
        UIPasteboard.general.string = Donation.accountNumber
        if !qrSaved { await saveQRCode() }
        openBankApp(app)
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
            qrSaved = true
            saveResult = "Đã lưu mã QR vào ảnh. Mở ứng dụng ngân hàng › Quét QR › chọn ảnh vừa lưu."
        } catch {
            saveResult = "Không lưu được ảnh: \(error.localizedDescription)"
        }
    }
}
