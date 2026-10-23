import Observation
import SwiftUI

/// Polls the chat of a live stream, or plays back a finished stream's chat in sync
/// with the video.
@MainActor
@Observable
final class LiveChatModel {
    private(set) var messages: [LiveChatMessage] = []
    private(set) var error: String?
    private(set) var isLoading = true
    private(set) var hasEnded = false
    private(set) var sendParams: String?
    private(set) var restrictedMessage: String?
    private(set) var selectedMode: LiveChatInfo.Mode
    let info: LiveChatInfo

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var seenIds = Set<String>()
    private static let maxMessages = 250

    init(info: LiveChatInfo) {
        self.info = info
        selectedMode = info.modes[0]
    }

    func start() {
        task?.cancel()
        messages = []
        seenIds = []
        error = nil
        hasEnded = false
        isLoading = true
        let mode = selectedMode
        task = Task { [weak self] in
            guard let self else { return }
            if self.info.isReplay {
                await self.runReplay(mode)
            } else {
                await self.runLive(mode)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    func select(_ mode: LiveChatInfo.Mode) {
        guard mode != selectedMode else { return }
        selectedMode = mode
        start()
    }

    // MARK: Live

    private func runLive(_ mode: LiveChatInfo.Mode) async {
        var token = mode.continuation
        // Like youtube.com, the first request opens the chat frame; later ones poll the API.
        var fromPage = true
        var failures = 0
        var fetches = 0
        while !Task.isCancelled {
            do {
                let json = fromPage
                    ? try await InnerTube.shared.liveChatPage(continuation: token, replay: false)
                    : try await InnerTube.shared.liveChat(continuation: token)
                let chunk = LiveChatParser.parse(json)
                guard !Task.isCancelled else { return }
                fetches += 1
                if fetches <= 2 {
                    Log.debug("live chat: \(chunk.messages.count) messages via \(fromPage ? "page" : "api"), next=\(chunk.continuation != nil), canSend=\(chunk.sendParams != nil)")
                }
                failures = 0
                fromPage = false
                apply(chunk)
                guard let next = chunk.continuation else {
                    hasEnded = true
                    return
                }
                token = next
                let delay = min(max(chunk.timeoutMs ?? 5000, 1000), 8000)
                try await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
            } catch is CancellationError {
                return
            } catch {
                failures += 1
                isLoading = false
                Log.debug("live chat \(fromPage ? "page" : "poll") failed: \(error.localizedDescription)")
                if fromPage {
                    // The frame did not load: try the API with the same token.
                    fromPage = false
                } else if failures >= 2 {
                    // The polling token may have expired: start over from the frame.
                    token = mode.continuation
                    fromPage = true
                }
                if failures >= 4 { self.error = error.localizedDescription }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    // MARK: Replay

    /// Fetches chunks around the current playback position and releases each message
    /// when the video reaches it.
    private func runReplay(_ mode: LiveChatInfo.Mode) async {
        var pending: [LiveChatMessage] = []
        var next: String?
        var seekToken: String?
        var fromPage = true
        var lastMs = -1
        var exhausted = false

        while !Task.isCancelled {
            let nowMs = Int(PlayerManager.shared.currentTime * 1000)
            // A seek: start over from the new position.
            if lastMs >= 0, nowMs < lastMs - 3000 || nowMs > lastMs + 20_000 {
                messages = []
                seenIds = []
                pending = []
                if let seekToken { next = seekToken } else { fromPage = true }
                exhausted = false
            }
            lastMs = nowMs

            let needsMore = pending.isEmpty || (pending.last?.offsetMs ?? 0) < nowMs + 5000
            if needsMore, !exhausted, fromPage || next != nil {
                do {
                    let json = fromPage
                        ? try await InnerTube.shared.liveChatPage(continuation: mode.continuation, replay: true)
                        : try await InnerTube.shared.liveChatReplay(continuation: next ?? mode.continuation, offsetMs: nowMs)
                    let chunk = LiveChatParser.parse(json)
                    guard !Task.isCancelled else { return }
                    let wasPage = fromPage
                    fromPage = false
                    error = nil
                    // Only what is around the current position (the frame starts at 0:00).
                    let fresh = chunk.messages.filter {
                        !seenIds.contains($0.id) && !pending.contains($0) && ($0.offsetMs ?? 0) >= nowMs - 30_000
                    }
                    pending = (pending + fresh).sorted { ($0.offsetMs ?? 0) < ($1.offsetMs ?? 0) }
                    seekToken = chunk.seekContinuation ?? seekToken
                    next = chunk.continuation
                    if wasPage, let seek = chunk.seekContinuation, (chunk.messages.last?.offsetMs ?? 0) < nowMs - 10_000 {
                        next = seek
                    }
                    exhausted = next == nil
                    if exhausted, pending.isEmpty { hasEnded = true }
                } catch is CancellationError {
                    return
                } catch {
                    Log.debug("live chat replay \(fromPage ? "page" : "fetch") failed: \(error.localizedDescription)")
                    if fromPage {
                        fromPage = false
                        next = mode.continuation
                    } else {
                        self.error = error.localizedDescription
                        try? await Task.sleep(nanoseconds: 4_000_000_000)
                    }
                }
            }
            isLoading = false

            let due = pending.prefix { ($0.offsetMs ?? 0) <= nowMs }
            if !due.isEmpty {
                pending.removeFirst(due.count)
                append(Array(due))
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
    }

    // MARK: Messages

    private func apply(_ chunk: LiveChatChunk) {
        isLoading = false
        error = nil
        if let params = chunk.sendParams { sendParams = params }
        if let restricted = chunk.restrictedMessage { restrictedMessage = restricted }
        if !chunk.removedIds.isEmpty {
            let removed = Set(chunk.removedIds)
            messages.removeAll { removed.contains($0.id) }
        }
        append(chunk.messages)
    }

    private func append(_ newMessages: [LiveChatMessage]) {
        let fresh = newMessages.filter { seenIds.insert($0.id).inserted }
        guard !fresh.isEmpty else { return }
        messages.append(contentsOf: fresh)
        if messages.count > Self.maxMessages {
            messages.removeFirst(messages.count - Self.maxMessages)
        }
    }

    func send(_ text: String) async -> Bool {
        guard let params = sendParams else { return false }
        do {
            let chunk = LiveChatParser.parse(try await InnerTube.shared.sendLiveChatMessage(text, params: params))
            append(chunk.messages)
            return true
        } catch {
            PlayerManager.shared.showToast("Không gửi được tin nhắn: \(error.localizedDescription)")
            return false
        }
    }
}

struct LiveChatSheet: View {
    @State private var model: LiveChatModel
    @State private var draft = ""
    @State private var isSending = false
    @State private var followLatest = true
    @Environment(AccountStore.self) private var account
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    init(info: LiveChatInfo) {
        _model = State(initialValue: LiveChatModel(info: info))
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(model.messages) { message in
                            LiveChatRow(message: message, showsTime: model.info.isReplay)
                                .id(message.id)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
                .overlay { statusOverlay }
                .simultaneousGesture(DragGesture().onChanged { value in
                    // Scrolling up to read older messages pauses auto-scroll.
                    if value.translation.height > 20 { followLatest = false }
                })
                .onChange(of: model.messages.last?.id) { _, _ in
                    guard followLatest else { return }
                    withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .overlay(alignment: .bottom) {
                    if !followLatest, !model.messages.isEmpty {
                        Button {
                            followLatest = true
                            proxy.scrollTo("bottom", anchor: .bottom)
                        } label: {
                            Label("Tin nhắn mới nhất", systemImage: "arrow.down")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(Capsule().fill(.regularMaterial))
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, 8)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) { footer }
            .navigationTitle(model.info.isReplay ? "Phát lại nội dung trò chuyện" : "Trò chuyện trực tiếp")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.info.modes.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            ForEach(model.info.modes, id: \.continuation) { mode in
                                Button {
                                    followLatest = true
                                    model.select(mode)
                                } label: {
                                    if mode == model.selectedMode {
                                        Label(mode.title, systemImage: "checkmark")
                                    } else {
                                        Text(mode.title)
                                    }
                                }
                            }
                        } label: {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var statusOverlay: some View {
        if model.messages.isEmpty {
            if model.isLoading {
                ProgressView()
            } else if let error = model.error {
                ErrorStateView(message: error) { model.start() }
            } else if model.hasEnded {
                ContentUnavailableView("Cuộc trò chuyện đã kết thúc", systemImage: "bubble.left.and.bubble.right")
            } else if model.info.isReplay {
                Text("Tin nhắn sẽ hiện theo thời điểm của video.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("Chưa có tin nhắn.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if model.info.isReplay {
            EmptyView()
        } else if account.isSignedIn, model.sendParams != nil {
            HStack(spacing: 10) {
                AvatarView(url: account.profile?.avatar, size: 28, name: account.profile?.name ?? "")
                TextField("Trò chuyện…", text: $draft, axis: .vertical)
                    .lineLimit(1...3)
                    .submitLabel(.send)
                    .onSubmit { Task { await send() } }
                Button {
                    Task { await send() }
                } label: {
                    if isSending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(.bar)
        } else if let restricted = model.restrictedMessage, account.isSignedIn {
            notice(restricted)
        } else if !account.isSignedIn {
            Button {
                dismiss()
                router.signIn()
            } label: {
                notice("Đăng nhập để tham gia trò chuyện")
            }
            .buttonStyle(.plain)
        }
    }

    private func notice(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(.bar)
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        isSending = true
        if await model.send(text) {
            draft = ""
            followLatest = true
        }
        isSending = false
    }
}

private struct LiveChatRow: View {
    let message: LiveChatMessage
    let showsTime: Bool

    var body: some View {
        switch message.kind {
        case .paid(let amount, let color):
            paidCard(amount: amount, color: color.map(Color.init(argb:)) ?? Color.orange)
        case .membership(let header):
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    AvatarView(url: message.authorPhoto, size: 26, name: message.author)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(message.author).font(.caption.weight(.semibold))
                        Text(header).font(.caption2)
                    }
                }
                if !message.text.isEmpty { Text(message.text).font(.footnote) }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.green.opacity(0.25)))
        case .system:
            Text(message.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
        case .text:
            HStack(alignment: .top, spacing: 8) {
                AvatarView(url: message.authorPhoto, size: 24, name: message.author)
                (timeText + authorText + Text(message.text))
                    .font(.footnote)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var timeText: Text {
        guard showsTime, let time = message.timestampText else { return Text("") }
        return Text(time + "  ").foregroundColor(.secondary)
    }

    private var authorText: Text {
        var name = Text(message.author + (message.isVerified ? " ✓" : "")).fontWeight(.semibold)
        if message.isOwner {
            name = name.foregroundColor(.orange)
        } else if message.isModerator {
            name = name.foregroundColor(.blue) + Text(" 🔧")
        } else if message.isMember {
            name = name.foregroundColor(.green)
        } else {
            name = name.foregroundColor(.secondary)
        }
        return name + Text("  ")
    }

    private func paidCard(amount: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                AvatarView(url: message.authorPhoto, size: 28, name: message.author)
                VStack(alignment: .leading, spacing: 1) {
                    Text(message.author).font(.caption.weight(.semibold))
                    Text(amount).font(.subheadline.weight(.bold))
                }
                Spacer()
            }
            if !message.text.isEmpty {
                Text(message.text).font(.footnote)
            }
        }
        .foregroundStyle(.black)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(color))
    }
}

private extension Color {
    /// YouTube sends Super Chat colours as ARGB integers.
    init(argb: UInt32) {
        self.init(
            .sRGB,
            red: Double((argb >> 16) & 0xFF) / 255,
            green: Double((argb >> 8) & 0xFF) / 255,
            blue: Double(argb & 0xFF) / 255,
            opacity: max(Double((argb >> 24) & 0xFF) / 255, 0.6)
        )
    }
}
