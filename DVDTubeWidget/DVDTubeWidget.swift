import SwiftUI
import UIKit
import WidgetKit

/// Home-screen widgets of DVDTube: "Tiếp tục xem" (small), continue + new videos (medium),
/// a list (large). The app writes `widget.json` and small thumbnails into the App Group
/// container; every tap opens `dvdtube://watch?v=<id>`.
@main
struct DVDTubeWidgetBundle: WidgetBundle {
    var body: some Widget {
        DVDTubeHomeWidget()
    }
}

/// Must match `WidgetBridge.Payload` in the app.
struct WidgetPayload: Codable {
    struct Item: Codable {
        var id: String
        var title: String
        var channel: String?
        var progress: Double
        var durationText: String?
        var image: String?
        var thumbnailURL: String?
    }

    var updatedAt: Date
    var continueWatching: [Item]
    var newVideos: [Item]
}

struct WidgetVideo: Identifiable {
    var id: String
    var title: String
    var channel: String?
    var progress: Double
    var durationText: String?
    var image: UIImage?

    var url: URL { URL(string: "dvdtube://watch?v=\(id)") ?? URL(string: "dvdtube://")! }
}

struct DVDTubeEntry: TimelineEntry {
    var date: Date
    var continueWatching: [WidgetVideo]
    var newVideos: [WidgetVideo]
    /// The app has not shared anything yet (or the App Group is unavailable).
    var isEmpty: Bool { continueWatching.isEmpty && newVideos.isEmpty }

    static let placeholder = DVDTubeEntry(
        date: Date(),
        continueWatching: [WidgetVideo(id: "placeholder", title: "Video bạn đang xem dở", channel: "DVDTube", progress: 0.4)],
        newVideos: [
            WidgetVideo(id: "p1", title: "Video mới từ kênh đăng ký", channel: "Kênh", progress: 0),
            WidgetVideo(id: "p2", title: "Một video mới khác", channel: "Kênh", progress: 0),
        ]
    )
}

struct DVDTubeProvider: TimelineProvider {
    static let appGroup = "group.com.dangdvd.dvdtube"

    func placeholder(in context: Context) -> DVDTubeEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (DVDTubeEntry) -> Void) {
        let entry = Self.load(limit: 6)
        completion(context.isPreview && entry.isEmpty ? .placeholder : entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DVDTubeEntry>) -> Void) {
        let entry = Self.load(limit: 6)
        // The app asks for a reload when history or subscriptions change.
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
    }

    static func load(limit: Int) -> DVDTubeEntry {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
              let data = try? Data(contentsOf: container.appendingPathComponent("widget.json")),
              let payload = try? JSONDecoder().decode(WidgetPayload.self, from: data) else {
            return DVDTubeEntry(date: Date(), continueWatching: [], newVideos: [])
        }
        let folder = container.appendingPathComponent("thumbs", isDirectory: true)
        func video(_ item: WidgetPayload.Item) -> WidgetVideo {
            var image: UIImage?
            if let name = item.image {
                image = UIImage(contentsOfFile: folder.appendingPathComponent(name).path)
            }
            return WidgetVideo(id: item.id, title: item.title, channel: item.channel, progress: item.progress,
                               durationText: item.durationText, image: image)
        }
        return DVDTubeEntry(
            date: Date(),
            continueWatching: payload.continueWatching.prefix(limit).map(video),
            newVideos: payload.newVideos.prefix(limit).map(video)
        )
    }
}

struct DVDTubeHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DVDTubeHome", provider: DVDTubeProvider()) { entry in
            DVDTubeWidgetView(entry: entry)
        }
        .configurationDisplayName("DVDTube")
        .description("Tiếp tục xem và video mới từ kênh đăng ký.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Views

private let brand = Color(red: 1.0, green: 0.24, blue: 0.35)

struct DVDTubeWidgetView: View {
    let entry: DVDTubeEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if entry.isEmpty {
                emptyView
            } else {
                switch family {
                case .systemSmall: small
                case .systemMedium: medium
                default: large
                }
            }
        }
        .containerBackground(for: .widget) {
            Color(.systemBackground)
        }
    }

    private var emptyView: some View {
        VStack(spacing: 6) {
            Image(systemName: "play.rectangle.fill")
                .font(.title)
                .foregroundStyle(brand)
            Text("Mở DVDTube để xem tiếp")
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.center)
        }
        .widgetURL(URL(string: "dvdtube://"))
    }

    // Small: the last unfinished video.
    @ViewBuilder
    private var small: some View {
        if let video = entry.continueWatching.first ?? entry.newVideos.first {
            VStack(alignment: .leading, spacing: 6) {
                Thumbnail(video: video)
                    .frame(maxWidth: .infinity)
                    .frame(height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Text(entry.continueWatching.isEmpty ? "Video mới" : "Tiếp tục xem")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(brand)
                Text(video.title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(2)
                Spacer(minLength: 0)
            }
            .widgetURL(video.url)
        }
    }

    // Medium: continue watching + 2 new videos.
    private var medium: some View {
        HStack(spacing: 10) {
            if let video = entry.continueWatching.first {
                Link(destination: video.url) {
                    VStack(alignment: .leading, spacing: 4) {
                        Thumbnail(video: video)
                            .frame(maxWidth: .infinity)
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Text("Tiếp tục xem").font(.caption2.weight(.bold)).foregroundStyle(brand)
                        Text(video.title).font(.caption.weight(.semibold)).lineLimit(2)
                        Spacer(minLength: 0)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            let others = Array(entry.newVideos.prefix(entry.continueWatching.isEmpty ? 3 : 2))
            if !others.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Video mới").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    ForEach(others) { video in
                        Link(destination: video.url) {
                            HStack(spacing: 6) {
                                Thumbnail(video: video)
                                    .frame(width: 56, height: 32)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))
                                Text(video.title).font(.caption2).lineLimit(2)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    // Large: lists.
    private var large: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !entry.continueWatching.isEmpty {
                Text("Tiếp tục xem").font(.caption.weight(.bold)).foregroundStyle(brand)
                ForEach(entry.continueWatching.prefix(entry.newVideos.isEmpty ? 6 : 3)) { video in
                    row(video)
                }
            }
            if !entry.newVideos.isEmpty {
                Text("Video mới từ kênh đăng ký").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                    .padding(.top, entry.continueWatching.isEmpty ? 0 : 4)
                ForEach(entry.newVideos.prefix(entry.continueWatching.isEmpty ? 6 : 3)) { video in
                    row(video)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func row(_ video: WidgetVideo) -> some View {
        Link(destination: video.url) {
            HStack(spacing: 8) {
                Thumbnail(video: video)
                    .frame(width: 80, height: 45)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 2) {
                    Text(video.title).font(.caption.weight(.semibold)).lineLimit(2)
                    if let channel = video.channel {
                        Text(channel).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct Thumbnail: View {
    let video: WidgetVideo

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let image = video.image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Rectangle()
                    .fill(Color(.secondarySystemFill))
                    .overlay(Image(systemName: "play.fill").foregroundStyle(.secondary))
            }
            if video.progress > 0.01 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Color.gray.opacity(0.6))
                        Rectangle().fill(brand).frame(width: geo.size.width * min(max(video.progress, 0), 1))
                    }
                }
                .frame(height: 3)
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .clipped()
    }
}
