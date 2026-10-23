import SwiftUI

struct SearchView: View {
    var initialQuery: String?

    @Environment(LibraryStore.self) private var library
    @Environment(PlayerManager.self) private var player

    @State private var query = ""
    @State private var submitted: String?
    @State private var filter: SearchFilter = .all
    @State private var suggestions: [String] = []
    @State private var model: FeedModel?
    @State private var suggestTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if focused || submitted == nil {
                suggestionList
            } else {
                results
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) { searchField }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if submitted == nil, let initialQuery {
                query = initialQuery
                submit(initialQuery)
            } else if submitted == nil {
                focused = true
            }
        }
        .onChange(of: query) { _, newValue in
            updateSuggestions(for: newValue)
        }
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Tìm kiếm hoặc dán liên kết", text: $query)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit { submit(query) }
            if !query.isEmpty {
                Button {
                    query = ""
                    focused = true
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Capsule().fill(Color(.secondarySystemFill)))
        .frame(maxWidth: .infinity)
    }

    private var suggestionList: some View {
        let showingHistory = query.trimmingCharacters(in: .whitespaces).isEmpty
        let entries = showingHistory ? library.searchHistory : suggestions
        return List {
            if YouTubeService.videoId(from: query) != nil {
                Button {
                    submit(query)
                } label: {
                    Label("Mở video từ liên kết", systemImage: "link")
                }
            }
            ForEach(entries, id: \.self) { entry in
                HStack(spacing: 14) {
                    Image(systemName: showingHistory ? "clock.arrow.circlepath" : "magnifyingglass")
                        .foregroundStyle(.secondary)
                    Text(entry).lineLimit(2)
                    Spacer()
                    Button {
                        query = entry
                        focused = true
                    } label: {
                        Image(systemName: "arrow.up.left").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    query = entry
                    submit(entry)
                }
                .swipeActions {
                    if showingHistory {
                        Button("Xóa", role: .destructive) { library.removeSearch(entry) }
                    }
                }
            }
            if showingHistory, !library.searchHistory.isEmpty {
                Button("Xóa lịch sử tìm kiếm", role: .destructive) { library.clearSearchHistory() }
                    .font(.footnote)
            }
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.immediately)
    }

    private var results: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SearchFilter.allCases) { item in
                        Button {
                            guard item != filter else { return }
                            filter = item
                            if let submitted { runSearch(submitted) }
                        } label: {
                            Text(item.title)
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .foregroundStyle(filter == item ? Color(.systemBackground) : Color.primary)
                                .background(RoundedRectangle(cornerRadius: 8).fill(filter == item ? Color.primary : Color(.secondarySystemFill)))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            ScrollView {
                if let model {
                    if model.isLoading && model.items.isEmpty {
                        LoadingStateView()
                    } else if let error = model.error, model.items.isEmpty {
                        ErrorStateView(message: error) { Task { await model.load(force: true) } }
                    } else if model.items.isEmpty {
                        ContentUnavailableView.search(text: submitted ?? "")
                    } else {
                        FeedList(items: model.items, isLoadingMore: model.isLoadingMore) {
                            Task { await model.loadMore() }
                        }
                        .padding(.top, 4)
                    }
                }
            }
            .scrollDismissesKeyboard(.immediately)
        }
    }

    private func updateSuggestions(for text: String) {
        suggestTask?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            suggestions = []
            return
        }
        suggestTask = Task {
            try? await Task.sleep(nanoseconds: 180_000_000)
            guard !Task.isCancelled else { return }
            let results = await YouTubeService.shared.suggestions(trimmed)
            guard !Task.isCancelled else { return }
            suggestions = results
        }
    }

    private func submit(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if let id = YouTubeService.videoId(from: trimmed) {
            focused = false
            player.play(VideoItem(id: id, title: ""))
            return
        }
        library.addSearch(trimmed)
        submitted = trimmed
        focused = false
        runSearch(trimmed)
    }

    private func runSearch(_ text: String) {
        let filter = filter
        let newModel = FeedModel { try await YouTubeService.shared.search(text, filter: filter) }
        model = newModel
        Task { await newModel.load() }
    }
}
