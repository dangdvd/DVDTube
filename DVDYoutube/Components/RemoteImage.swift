import SwiftUI
import UIKit

/// `NSCache` is thread-safe but not annotated as `Sendable`.
private final class ImageCache: @unchecked Sendable {
    let storage: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.totalCostLimit = 96 << 20
        return cache
    }()
}

/// Memory-cached, de-duplicated image loading for thumbnails and avatars.
actor ImageLoader {
    static let shared = ImageLoader()

    private nonisolated let cache = ImageCache()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    nonisolated func cached(_ url: URL) -> UIImage? {
        cache.storage.object(forKey: url as NSURL)
    }

    func image(for url: URL) async -> UIImage? {
        if let cached = cached(url) { return cached }
        if let task = inFlight[url] { return await task.value }
        let task = Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let result = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: result.0) else { return nil }
            return image.preparingForDisplay() ?? image
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image {
            cache.storage.setObject(image, forKey: url as NSURL, cost: Int(image.size.width * image.size.height * image.scale * 4))
        }
        return image
    }
}

/// Data saver on mobile data: video thumbnails in the small 320×180 size instead of HD.
@MainActor
func dataSavingThumbnail(_ url: URL) -> URL {
    guard AppSettings.shared.savesData, url.host?.hasSuffix("ytimg.com") == true else { return url }
    let parts = url.path.split(separator: "/")
    guard parts.count >= 3, parts[0] == "vi" || parts[0] == "vi_webp", let file = parts.last,
          file.hasPrefix("hq") || file.hasPrefix("maxres") || file.hasPrefix("sd") else { return url }
    return URL(string: "https://i.ytimg.com/vi/\(parts[1])/mqdefault.jpg") ?? url
}

struct RemoteImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?

    var body: some View {
        // A cached image shows on the first render (no placeholder frame and no extra update
        // per card while scrolling back through a feed).
        let shown = image ?? url.flatMap { ImageLoader.shared.cached(dataSavingThumbnail($0)) }
        Rectangle()
            .fill(Color(.secondarySystemFill))
            .overlay {
                if let shown {
                    Image(uiImage: shown)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .transition(.opacity)
                }
            }
            .clipped()
            .task(id: url) {
                guard let original = url else {
                    image = nil
                    return
                }
                let url = dataSavingThumbnail(original)
                if let cached = ImageLoader.shared.cached(url) {
                    if image !== cached { image = cached }
                    return
                }
                image = nil
                let loaded = await ImageLoader.shared.image(for: url)
                withAnimation(.easeOut(duration: 0.2)) { image = loaded }
            }
    }
}

struct AvatarView: View {
    let url: URL?
    var size: CGFloat = 36
    var name: String = ""

    var body: some View {
        ZStack {
            Circle().fill(Color(.tertiarySystemFill))
            if url == nil, let initial = name.first {
                Text(String(initial).uppercased())
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            if url != nil {
                RemoteImage(url: url)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}
