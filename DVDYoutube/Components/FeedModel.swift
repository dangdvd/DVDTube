import Observation
import SwiftUI

/// Loading + pagination state for any continuation-based feed.
@MainActor
@Observable
final class FeedModel {
    private(set) var items: [FeedItem] = []
    private(set) var continuation: String?
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var error: String?
    private(set) var hasLoaded = false

    @ObservationIgnored private let loader: () async throws -> FeedPage
    @ObservationIgnored private var kind: ContinuationKind = .browse
    @ObservationIgnored private var generation = 0

    init(loader: @escaping () async throws -> FeedPage) {
        self.loader = loader
    }

    var videos: [VideoItem] { items.compactMap(\.video) }

    func load(force: Bool = false) async {
        guard force || (!hasLoaded && !isLoading) else { return }
        generation += 1
        let current = generation
        isLoading = true
        error = nil
        do {
            let page = try await loader()
            guard current == generation else { return }
            items = page.items
            continuation = page.continuation
            kind = page.kind
            hasLoaded = true
        } catch {
            guard current == generation else { return }
            if !(error is CancellationError) { self.error = error.localizedDescription }
        }
        isLoading = false
    }

    func loadMore() async {
        guard let token = continuation, !isLoadingMore, !isLoading else { return }
        isLoadingMore = true
        let current = generation
        do {
            let page = try await YouTubeService.shared.more(token, kind: kind)
            guard current == generation else { return }
            let existing = Set(items.map(\.id))
            items.append(contentsOf: page.items.filter { !existing.contains($0.id) })
            continuation = page.continuation == token ? nil : page.continuation
        } catch {
            continuation = nil
        }
        isLoadingMore = false
    }

    func replace(with page: FeedPage) {
        generation += 1
        items = page.items
        continuation = page.continuation
        kind = page.kind
        hasLoaded = true
        isLoading = false
        error = nil
    }
}

struct LoadingStateView: View {
    var body: some View {
        VStack(spacing: 24) {
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    Rectangle().fill(Color(.secondarySystemFill)).aspectRatio(16 / 9, contentMode: .fit)
                    HStack(alignment: .top, spacing: 12) {
                        Circle().fill(Color(.secondarySystemFill)).frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 6) {
                            RoundedRectangle(cornerRadius: 4).fill(Color(.secondarySystemFill)).frame(height: 14)
                            RoundedRectangle(cornerRadius: 4).fill(Color(.secondarySystemFill)).frame(width: 180, height: 12)
                        }
                    }
                    .padding(.horizontal, 12)
                }
            }
        }
        .redacted(reason: .placeholder)
        .shimmering()
    }
}

struct ErrorStateView: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("Không tải được nội dung", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            if let retry {
                Button("Thử lại", action: retry)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(.top, 40)
    }
}

private struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { geo in
                    LinearGradient(
                        colors: [.clear, Color.white.opacity(0.25), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: phase * geo.size.width * 1.6)
                }
                .allowsHitTesting(false)
            }
            .clipped()
            .onAppear {
                withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    func shimmering() -> some View { modifier(Shimmer()) }
}
