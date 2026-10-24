import SwiftUI

/// YouTube's search filters ("Bộ lọc tìm kiếm"), encoded the way the website does: a small
/// protobuf message, base64 encoded, sent as the search `params`.
struct SearchFilters: Equatable {
    enum UploadDate: Int, CaseIterable, Identifiable {
        case any = 0, lastHour = 1, today = 2, thisWeek = 3, thisMonth = 4, thisYear = 5
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .any: return "Bất kỳ lúc nào"
            case .lastHour: return "Trong 1 giờ qua"
            case .today: return "Hôm nay"
            case .thisWeek: return "Tuần này"
            case .thisMonth: return "Tháng này"
            case .thisYear: return "Năm nay"
            }
        }
    }

    enum Kind: Int, CaseIterable, Identifiable {
        case all = 0, video = 1, shorts = 9, channel = 2, playlist = 3, movie = 4
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .all: return "Tất cả"
            case .video: return "Video"
            case .shorts: return "Shorts"
            case .channel: return "Kênh"
            case .playlist: return "Danh sách phát"
            case .movie: return "Phim"
            }
        }
    }

    enum Duration: Int, CaseIterable, Identifiable {
        case any = 0, short = 1, medium = 3, long = 2
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .any: return "Bất kỳ"
            case .short: return "Dưới 4 phút"
            case .medium: return "4–20 phút"
            case .long: return "Trên 20 phút"
            }
        }
    }

    /// Boolean filters; the raw value is the protobuf field number.
    enum Feature: Int, CaseIterable, Identifiable {
        case live = 8, uhd4K = 14, hd = 4, subtitles = 5, creativeCommons = 6, degrees360 = 15, hdr = 25, vr180 = 26
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .live: return "Trực tiếp"
            case .uhd4K: return "4K"
            case .hd: return "HD"
            case .subtitles: return "Phụ đề"
            case .creativeCommons: return "Creative Commons"
            case .degrees360: return "360°"
            case .hdr: return "HDR"
            case .vr180: return "VR180"
            }
        }
    }

    enum Sort: Int, CaseIterable, Identifiable {
        case relevance = 0, uploadDate = 2, viewCount = 3, rating = 1
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .relevance: return "Mức độ liên quan"
            case .uploadDate: return "Ngày tải lên"
            case .viewCount: return "Lượt xem"
            case .rating: return "Xếp hạng"
            }
        }
    }

    var uploadDate: UploadDate = .any
    var kind: Kind = .all
    var duration: Duration = .any
    var features: Set<Feature> = []
    var sort: Sort = .relevance

    var isEmpty: Bool { self == SearchFilters() }

    /// How many filters differ from the defaults (shown as a badge).
    var activeCount: Int {
        (uploadDate != .any ? 1 : 0) + (kind != .all ? 1 : 0) + (duration != .any ? 1 : 0)
            + features.count + (sort != .relevance ? 1 : 0)
    }

    /// The quick filter chips above the results set the same fields.
    func applying(_ chip: SearchFilter) -> SearchFilters {
        var result = self
        switch chip {
        case .all: break
        case .videos: result.kind = .video
        case .shorts: result.kind = .shorts
        case .channels: result.kind = .channel
        case .playlists: result.kind = .playlist
        case .live: result.features.insert(.live)
        case .recent: result.sort = .uploadDate
        }
        return result
    }

    /// `params` for the search endpoint, or nil when nothing is filtered.
    var params: String? {
        var filters: [UInt8] = []
        func field(_ number: Int, _ value: Int) {
            filters += Self.varint(number << 3) + Self.varint(value)
        }
        if uploadDate != .any { field(1, uploadDate.rawValue) }
        if kind != .all { field(2, kind.rawValue) }
        if duration != .any { field(3, duration.rawValue) }
        for feature in features.sorted(by: { $0.rawValue < $1.rawValue }) { field(feature.rawValue, 1) }

        var message: [UInt8] = []
        if sort != .relevance { message += [0x08] + Self.varint(sort.rawValue) }
        if !filters.isEmpty { message += [0x12] + Self.varint(filters.count) + filters }
        guard !message.isEmpty else { return nil }
        // Same shape the website sends (URL-encoded base64).
        return Data(message).base64EncodedString()
            .replacingOccurrences(of: "+", with: "%2B")
            .replacingOccurrences(of: "/", with: "%2F")
            .replacingOccurrences(of: "=", with: "%3D")
    }

    private static func varint(_ value: Int) -> [UInt8] {
        var value = UInt64(value)
        var bytes: [UInt8] = []
        repeat {
            var byte = UInt8(value & 0x7F)
            value >>= 7
            if value != 0 { byte |= 0x80 }
            bytes.append(byte)
        } while value != 0
        return bytes
    }
}

struct SearchFiltersSheet: View {
    @Binding var filters: SearchFilters
    var onApply: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft = SearchFilters()

    var body: some View {
        NavigationStack {
            Form {
                Picker("Ngày tải lên", selection: $draft.uploadDate) {
                    ForEach(SearchFilters.UploadDate.allCases) { Text($0.title).tag($0) }
                }
                Picker("Loại", selection: $draft.kind) {
                    ForEach(SearchFilters.Kind.allCases) { Text($0.title).tag($0) }
                }
                Picker("Thời lượng", selection: $draft.duration) {
                    ForEach(SearchFilters.Duration.allCases) { Text($0.title).tag($0) }
                }
                Picker("Sắp xếp theo", selection: $draft.sort) {
                    ForEach(SearchFilters.Sort.allCases) { Text($0.title).tag($0) }
                }
                Section("Tính năng") {
                    ForEach(SearchFilters.Feature.allCases) { feature in
                        Toggle(feature.title, isOn: Binding(
                            get: { draft.features.contains(feature) },
                            set: { on in
                                if on { draft.features.insert(feature) } else { draft.features.remove(feature) }
                            }
                        ))
                    }
                }
                Section {
                    Button("Đặt lại bộ lọc", role: .destructive) { draft = SearchFilters() }
                        .disabled(draft.isEmpty)
                }
            }
            .navigationTitle("Bộ lọc tìm kiếm")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Áp dụng") {
                        filters = draft
                        onApply()
                        dismiss()
                    }
                }
            }
        }
        .onAppear { draft = filters }
    }
}
