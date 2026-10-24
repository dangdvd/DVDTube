// Parsers against synthetic responses shaped like YouTube's (search, player, watch page,
// comments, channel, playlist, account switcher, live chat, RSS, chat frame HTML).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { feedVideos } from '@shared/models'
import { parseCaptions, parseRss, parseSponsorSegments, relativeDate } from '../core/extras'
import { initialData } from '../core/innertube'
import { JNode } from '../core/json'
import { parseIdentities, parseNotifications, parsePlaylistOptions, parseProfile } from '../core/parsers/account'
import { parseAbout, parseChannel, parsePosts } from '../core/parsers/channel'
import { parseComments } from '../core/parsers/comments'
import * as ItemParser from '../core/parsers/items'
import { liveChatInfo, parseLiveChat } from '../core/parsers/livechat'
import { bestAudio, bestVideo, parsePlayer } from '../core/parsers/player'
import { parseMix, parsePlaylist } from '../core/parsers/playlist'
import { parseWatch } from '../core/parsers/watch'

const thumbs = (url: string, width = 480) => ({ thumbnails: [{ url: url + '?small', width: Math.floor(width / 4) }, { url, width }] })
const runs = (...texts: string[]) => ({ runs: texts.map((text) => ({ text })) })
const token = (value: string) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: value } } } })

describe('JNode', () => {
  it('reads defensively', () => {
    const node = new JNode({ a: { b: [1, '2', { c: 'x' }] }, n: 3.5, s: ' 42 ', t: { runs: [{ text: 'A' }, { text: 'B' }] }, z: null })
    assert.equal(node.at('a', 'b').get(0).int, 1)
    assert.equal(node.at('a', 'b').get(1).int, 2)
    assert.equal(node.at('a', 'b').get(5).exists, false)
    assert.equal(node.at('a', 'missing', 'c').exists, false)
    assert.equal(node.get('n').int, 3)
    assert.equal(node.get('n').string, '3.5')
    assert.equal(node.get('s').int, 42)
    assert.equal(node.get('t').text, 'AB')
    assert.equal(node.get('z').exists, false)
    assert.equal(node.findFirst('c').string, 'x')
    assert.equal(new JNode({ thumbnails: [{ url: '//a', width: 10 }, { url: '//b', width: 30 }] }).bestImageUrl, 'https://b')
  })
})

describe('item parser', () => {
  const search = new JNode({
    responseContext: { visitorData: 'VISITOR' },
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'VIDEO000001',
                        thumbnail: thumbs('https://i.ytimg.com/vi/VIDEO000001/hq720.jpg', 720),
                        title: runs('Nhạc trẻ remix 2026'),
                        ownerText: { runs: [{ text: 'Kênh Nhạc', navigationEndpoint: { browseEndpoint: { browseId: 'UCchannel000000000000001' } } }] },
                        publishedTimeText: { simpleText: '2 ngày trước' },
                        lengthText: { simpleText: '1:02:03' },
                        viewCountText: { simpleText: '1.234.567 lượt xem' },
                        shortViewCountText: { simpleText: '1,2 Tr lượt xem' },
                        channelThumbnailSupportedRenderers: {
                          channelThumbnailWithLinkRenderer: { thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/avatar', width: 68 }] } },
                        },
                        thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '1:02:03' }, style: 'DEFAULT' } }],
                      },
                    },
                    {
                      videoRenderer: {
                        videoId: 'LIVE0000001',
                        title: runs('Trực tiếp'),
                        badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }],
                        thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: 'TRỰC TIẾP' }, style: 'LIVE' } }],
                      },
                    },
                    {
                      reelShelfRenderer: {
                        items: [1, 2].map((n) => ({
                          shortsLockupViewModel: {
                            entityId: `shorts-shelf-item-SHORT00000${n}`,
                            onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: `SHORT00000${n}` } } },
                            overlayMetadata: { primaryText: { content: `Short ${n}` }, secondaryText: { content: '1,2 Tr lượt xem' } },
                            thumbnailViewModel: { thumbnailViewModel: { image: { sources: [{ url: `https://i.ytimg.com/vi/SHORT00000${n}/oar2.jpg`, width: 405 }] } } },
                          },
                        })),
                      },
                    },
                    {
                      channelRenderer: {
                        channelId: 'UCsontung000000000000001',
                        title: { simpleText: 'Sơn Tùng M-TP' },
                        thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/st', width: 88 }] },
                        subscriberCountText: { simpleText: '@sontungmtp' },
                        videoCountText: { simpleText: '11,3 Tr người đăng ký' },
                      },
                    },
                    {
                      lockupViewModel: {
                        contentId: 'PLplaylist0001',
                        contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                        contentImage: {
                          collectionThumbnailViewModel: {
                            primaryThumbnail: {
                              thumbnailViewModel: {
                                image: { sources: [{ url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480 }] },
                                overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '25 video' } }] } }],
                              },
                            },
                          },
                        },
                        metadata: {
                          lockupMetadataViewModel: {
                            title: { content: 'Playlist Hay' },
                            metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Người tạo' } }] }] } },
                          },
                        },
                      },
                    },
                    {
                      lockupViewModel: {
                        contentId: 'LOCKUPVID01',
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        contentImage: {
                          thumbnailViewModel: {
                            image: { sources: [{ url: 'https://i.ytimg.com/vi/LOCKUPVID01/hqdefault.jpg', width: 480 }] },
                            overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '12:34', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } }] } }],
                          },
                        },
                        metadata: {
                          lockupMetadataViewModel: {
                            title: { content: 'Video kiểu mới' },
                            image: {
                              decoratedAvatarViewModel: {
                                avatar: { avatarViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/av', width: 68 }] } } },
                                rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UClockup0000000000000001' } } } } },
                              },
                            },
                            metadata: {
                              contentMetadataViewModel: {
                                metadataRows: [
                                  { metadataParts: [{ text: { content: 'Kênh A' } }] },
                                  { metadataParts: [{ text: { content: '1,2 N lượt xem' } }, { text: { content: '3 giờ trước' } }] },
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                    { adSlotRenderer: { videoRenderer: { videoId: 'ADVERT00001', title: runs('Quảng cáo') } } },
                  ],
                },
              },
              token('SEARCH_NEXT'),
            ],
          },
        },
      },
    },
  })

  it('finds videos, shorts shelves, channels and playlists', () => {
    const page = ItemParser.page(search, 'search')
    assert.equal(page.continuation, 'SEARCH_NEXT')
    assert.equal(page.kind, 'search')
    const types = page.items.map((i) => i.type)
    assert.deepEqual(types, ['video', 'video', 'shorts', 'channel', 'playlist', 'video'])
    const first = page.items[0].type === 'video' ? page.items[0].video : null
    assert.deepEqual(first, {
      id: 'VIDEO000001',
      title: 'Nhạc trẻ remix 2026',
      channelName: 'Kênh Nhạc',
      channelId: 'UCchannel000000000000001',
      channelAvatar: 'https://yt3.ggpht.com/avatar',
      thumbnail: 'https://i.ytimg.com/vi/VIDEO000001/hq720.jpg',
      durationText: '1:02:03',
      durationSeconds: 3723,
      viewCountText: '1,2 Tr lượt xem',
      publishedText: '2 ngày trước',
      isLive: false,
      isShort: false,
    })
    const live = page.items[1].type === 'video' ? page.items[1].video : null
    assert.equal(live?.isLive, true)
    assert.equal(live?.durationText, null)
    const shelf = page.items[2]
    assert.equal(shelf.type === 'shorts' && shelf.items.map((v) => `${v.id}:${v.title}:${v.isShort}`).join(','), 'SHORT000001:Short 1:true,SHORT000002:Short 2:true')
    const channel = page.items[3].type === 'channel' ? page.items[3].channel : null
    assert.equal(channel?.handle, '@sontungmtp')
    assert.equal(channel?.subscriberText, '11,3 Tr người đăng ký')
    const playlist = page.items[4].type === 'playlist' ? page.items[4].playlist : null
    assert.deepEqual(playlist, { id: 'PLplaylist0001', title: 'Playlist Hay', thumbnail: 'https://i.ytimg.com/vi/x/hqdefault.jpg', channelName: 'Người tạo', videoCountText: '25 video' })
    const lockup = page.items[5].type === 'video' ? page.items[5].video : null
    assert.equal(lockup?.channelName, 'Kênh A')
    assert.equal(lockup?.channelId, 'UClockup0000000000000001')
    assert.equal(lockup?.durationSeconds, 754)
    assert.equal(lockup?.viewCountText, '1,2 N lượt xem')
    assert.equal(lockup?.publishedText, '3 giờ trước')
    assert.ok(!feedVideos(page).some((v) => v.id === 'ADVERT00001'), 'ads are skipped')
  })

  it('explains empty feeds', () => {
    const empty = new JNode({ contents: { feedNudgeRenderer: { title: runs('Hãy thử tìm kiếm để bắt đầu'), subtitle: runs('Bắt đầu xem video') } } })
    assert.equal(ItemParser.page(empty).message, 'Hãy thử tìm kiếm để bắt đầu\nBắt đầu xem video')
  })
})

describe('player parser', () => {
  const response = {
    playabilityStatus: { status: 'OK' },
    videoDetails: {
      videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', lengthSeconds: '19', channelId: 'UC4QobU6STFB0P71PMvOGN5A', author: 'jawed',
      viewCount: '380000000', isLive: false, thumbnail: thumbs('https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'), shortDescription: 'zoo',
    },
    streamingData: {
      formats: [{ itag: 18, url: 'https://rr1---sn-a.googlevideo.com/videoplayback?itag=18&c=VISIONOS', mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 300000, width: 320, height: 240, contentLength: '791367', qualityLabel: '240p' }],
      adaptiveFormats: [
        { itag: 137, url: 'https://v/137', mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 4000000, width: 1920, height: 1080, fps: 30, qualityLabel: '1080p', contentLength: '12345678', approxDurationMs: '19100', initRange: { start: '0', end: '740' }, indexRange: { start: '741', end: '1004' }, colorInfo: { primaries: 'COLOR_PRIMARIES_BT709', transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_BT709' } },
        { itag: 136, url: 'https://v/136', mimeType: 'video/mp4; codecs="avc1.4d401f"', bitrate: 1500000, width: 1280, height: 720, fps: 30, qualityLabel: '720p', initRange: { start: '0', end: '739' }, indexRange: { start: '740', end: '1000' } },
        { itag: 337, url: 'https://v/337', mimeType: 'video/webm; codecs="vp9.2"', bitrate: 20000000, width: 3840, height: 2160, fps: 60, qualityLabel: '2160p60 HDR', colorInfo: { primaries: 'COLOR_PRIMARIES_BT2020', transferCharacteristics: 'COLOR_TRANSFER_CHARACTERISTICS_SMPTEST2084' } },
        { itag: 140, url: 'https://a/140en', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, audioSampleRate: '44100', audioChannels: 2, audioTrack: { displayName: 'Tiếng Anh (gốc)', id: 'en.4', audioIsDefault: true }, initRange: { start: '0', end: '631' }, indexRange: { start: '632', end: '700' } },
        { itag: 140, url: 'https://a/140vi', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000, audioSampleRate: '44100', audioChannels: 2, audioTrack: { displayName: 'Tiếng Việt', id: 'vi.3', audioIsDefault: false } },
        { itag: 251, url: 'https://a/251', mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, audioSampleRate: '48000', audioChannels: 2 },
        { itag: 401, signatureCipher: 's=abc&url=https%3A%2F%2Fx', mimeType: 'video/mp4; codecs="av01.0.12M.08"' },
      ],
      hlsManifestUrl: 'https://manifest.googlevideo.com/api/manifest/hls_variant/x',
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&kind=asr', name: runs('English (auto-generated)'), languageCode: 'en', kind: 'asr', isTranslatable: true },
          { baseUrl: '/api/timedtext?v=jNQXAC9IVRw&lang=vi', name: { simpleText: 'Tiếng Việt' }, languageCode: 'vi', isTranslatable: true },
        ],
      },
    },
    storyboards: { playerStoryboardSpecRenderer: { spec: 'https://i.ytimg.com/sb/x/storyboard3_L$L/$N.jpg|48#27#10#10#10#0#default#rs$A|80#45#10#10#10#2000#M$M#rs$B' } },
    playerConfig: { audioConfig: { loudnessDb: -3.25 } },
    adPlacements: [
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_START' } }, renderer: { instreamVideoAdRenderer: { skipOffsetMilliseconds: 5000 } } } },
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_MILLISECONDS' } }, renderer: { instreamVideoAdRenderer: { skipOffsetMilliseconds: 99000 } } } },
    ],
  }

  it('reads every playable format with DASH byte ranges', () => {
    const info = parsePlayer(new JNode(response), 'jNQXAC9IVRw', 'VISIONOS', 1000)
    assert.equal(info.client, 'VISIONOS')
    assert.equal(info.title, 'Me at the zoo')
    assert.equal(info.lengthSeconds, 19)
    assert.equal(info.viewCount, 380000000)
    assert.equal(info.adaptiveFormats.length, 6, 'ciphered format skipped')
    assert.equal(info.muxedFormats.length, 1)
    assert.equal(info.hlsUrl, 'https://manifest.googlevideo.com/api/manifest/hls_variant/x')
    const f137 = info.adaptiveFormats[0]
    assert.deepEqual(f137.initRange, { start: 0, end: 740 })
    assert.deepEqual(f137.indexRange, { start: 741, end: 1004 })
    assert.equal(f137.approxDurationMs, 19100)
    assert.equal(f137.contentLength, 12345678)
    assert.equal(f137.colorInfo, null)
    assert.equal(info.adaptiveFormats[2].colorInfo, 'HDR')
    const vi = info.adaptiveFormats.find((f) => f.url.endsWith('140vi'))!
    assert.equal(vi.audioLanguage, 'vi')
    assert.equal(vi.isDefaultAudio, false)
    assert.equal(vi.audioSampleRate, 44100)
    assert.equal(vi.audioChannels, 2)
    assert.equal(info.adaptiveFormats.find((f) => f.itag === 251)!.isDefaultAudio, true)
    assert.equal(info.captions.length, 2)
    assert.equal(info.captions[0].isAutoGenerated, true)
    assert.equal(info.captions[1].baseUrl, 'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=vi')
    assert.equal(info.storyboard?.width, 80)
    assert.equal(info.loudnessDb, -3.25)
    assert.equal(info.availableAt, 6000, 'only the pre-roll counts')
    assert.equal(bestVideo(info, 720)?.itag, 136)
    assert.equal(bestVideo(info, 100)?.itag, 136, 'smallest H.264 when nothing fits')
    assert.equal(bestAudio(info)?.url, 'https://a/140en')
  })

  it('reports why a video cannot play', () => {
    assert.throws(
      () => parsePlayer(new JNode({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Đăng nhập để xác nhận bạn không phải là bot' } }), 'x'),
      (error: Error & { kind?: string }) => error.kind === 'loginRequired' && error.message.includes('không phải là bot'),
    )
    assert.throws(
      () => parsePlayer(new JNode({ playabilityStatus: { status: 'ERROR', errorScreen: { playerErrorMessageRenderer: { reason: runs('Video không có sẵn') } } } }), 'x'),
      (error: Error & { kind?: string }) => error.kind === 'unplayable' && error.message === 'Video không có sẵn',
    )
    assert.throws(() => parsePlayer(new JNode({ playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'other' } }), 'x'), /video khác/)
    assert.throws(() => parsePlayer(new JNode({ playabilityStatus: { status: 'OK' } }), 'x'), /Không tìm thấy luồng phát/)
  })
})

describe('watch page parser', () => {
  const next = new JNode({
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [
              {
                videoPrimaryInfoRenderer: {
                  title: runs('Tiêu đề video'),
                  viewCount: { videoViewCountRenderer: { viewCount: { simpleText: '1.234 lượt xem' }, shortViewCount: { simpleText: '1,2 N lượt xem' } } },
                  dateText: { simpleText: '12 thg 10, 2026' },
                  relativeDateText: { simpleText: '2 tuần trước' },
                  videoActions: {
                    menuRenderer: {
                      topLevelButtons: [
                        {
                          segmentedLikeDislikeButtonViewModel: {
                            likeButtonViewModel: {
                              likeButtonViewModel: {
                                toggleButtonViewModel: { toggleButtonViewModel: { defaultButtonViewModel: { buttonViewModel: { title: '12 N' } } } },
                                likeStatusEntity: { likeStatus: 'LIKE' },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
              {
                videoSecondaryInfoRenderer: {
                  owner: {
                    videoOwnerRenderer: {
                      title: { runs: [{ text: 'Kênh Chủ', navigationEndpoint: { browseEndpoint: { browseId: 'UCowner00000000000000001' } } }] },
                      thumbnail: thumbs('https://yt3.ggpht.com/owner', 88),
                      subscriberCountText: { simpleText: '1 Tr người đăng ký' },
                    },
                  },
                  attributedDescription: { content: 'Mô tả\n0:00 Mở đầu' },
                  subscribeButton: { subscribeButtonRenderer: { subscribed: true } },
                },
              },
              { itemSectionRenderer: { sectionIdentifier: 'comment-item-section', contents: [token('COMMENTS_TOKEN')] } },
            ],
          },
        },
        secondaryResults: {
          secondaryResults: {
            results: [
              { compactVideoRenderer: { videoId: 'RELATED0001', title: { simpleText: 'Liên quan' }, lengthText: { simpleText: '3:21' } } },
              { compactVideoRenderer: { videoId: 'BBBBBBBBBBB', title: { simpleText: 'Chính nó' } } },
              token('RELATED_NEXT'),
            ],
          },
        },
        playlist: {
          playlist: {
            title: 'Danh sách hay',
            playlistId: 'PLlist000001',
            currentIndex: 57,
            contents: [
              { playlistPanelVideoRenderer: { videoId: 'AAAAAAAAAAA', title: { simpleText: 'A' }, lengthText: { simpleText: '3:00' }, selected: false } },
              { playlistPanelVideoRenderer: { videoId: 'BBBBBBBBBBB', title: { simpleText: 'B' }, selected: true } },
              { playlistPanelVideoRenderer: { videoId: 'CCCCCCCCCCC', title: { simpleText: 'C' } } },
            ],
          },
        },
        conversationBar: {
          liveChatRenderer: {
            continuations: [{ reloadContinuationData: { continuation: 'CHAT_TOKEN' } }],
            isReplay: true,
            header: { liveChatHeaderRenderer: { viewSelector: { sortFilterSubMenuRenderer: { subMenuItems: [{ title: 'Tin nhắn hàng đầu', selected: true }, { title: 'Trò chuyện trực tiếp', selected: false }] } } } },
          },
        },
      },
    },
    engagementPanels: [
      { engagementPanelSectionListRenderer: { panelIdentifier: 'engagement-panel-comments-section', header: { engagementPanelTitleHeaderRenderer: { contextualInfo: runs('1.234') } } } },
      {
        engagementPanelSectionListRenderer: {
          panelIdentifier: 'engagement-panel-macro-markers-description-chapters',
          content: {
            macroMarkersListRenderer: {
              contents: [
                { macroMarkersListItemRenderer: { title: { simpleText: 'Phần 2' }, timeDescription: { simpleText: '1:30' } } },
                { macroMarkersListItemRenderer: { title: { simpleText: 'Mở đầu' }, timeDescription: { simpleText: '0:00' }, thumbnail: thumbs('https://i.ytimg.com/c0') } },
              ],
            },
          },
        },
      },
    ],
    frameworkUpdates: {
      entityBatchUpdate: {
        mutations: [
          {
            payload: {
              macroMarkersListEntity: {
                markersList: {
                  markerType: 'MARKER_TYPE_HEATMAP',
                  markers: [
                    { startMillis: '2000', durationMillis: '2000', intensityScoreNormalized: 0.5 },
                    { startMillis: '0', durationMillis: '2000', intensityScoreNormalized: 1 },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  })

  it('reads the details below the player', () => {
    const info = parseWatch(next, 'BBBBBBBBBBB')
    assert.equal(info.title, 'Tiêu đề video')
    assert.equal(info.viewCountText, '1.234 lượt xem')
    assert.equal(info.likeCountText, '12 N')
    assert.equal(info.likeStatus, 'LIKE')
    assert.equal(info.isSubscribed, true)
    assert.deepEqual(info.channel, { id: 'UCowner00000000000000001', name: 'Kênh Chủ', avatar: 'https://yt3.ggpht.com/owner', subscriberText: '1 Tr người đăng ký' })
    assert.equal(info.description, 'Mô tả\n0:00 Mở đầu')
    assert.equal(info.commentsToken, 'COMMENTS_TOKEN')
    assert.equal(info.commentCountText, '1.234')
    assert.deepEqual(info.chapters.map((c) => [c.title, c.startSeconds]), [['Mở đầu', 0], ['Phần 2', 90]])
    assert.deepEqual(info.heatmap, [{ start: 0, duration: 2, intensity: 1 }, { start: 2, duration: 2, intensity: 0.5 }])
    assert.deepEqual(feedVideos(info.related).map((v) => v.id), ['RELATED0001'], 'the video itself is not related')
    assert.equal(info.related.continuation, 'RELATED_NEXT')
    assert.equal(info.related.kind, 'next')
    assert.deepEqual(info.liveChat, { modes: [{ title: 'Tin nhắn hàng đầu', continuation: 'CHAT_TOKEN' }], isReplay: true })
    assert.equal(info.playlist?.id, 'PLlist000001')
    assert.equal(info.playlist?.title, 'Danh sách hay')
    assert.deepEqual(info.playlist?.videos.map((v) => v.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC'])
    assert.equal(info.playlist?.currentIndex, 1, 'index inside the loaded window, not the full playlist')
    assert.equal(liveChatInfo(JNode.EMPTY), null)
  })

  it('reads a mix from the playlist panel', () => {
    const mix = parseMix(next, 'RDBBBBBBBBBBB')
    assert.equal(mix.playlist.title, 'Danh sách hay')
    assert.equal(mix.playlist.videoCountText, '3 video')
    assert.equal(mix.page.continuation, null)
  })
})

describe('comments parser', () => {
  const json = new JNode({
    onResponseReceivedEndpoints: [
      {
        reloadContinuationItemsCommand: {
          continuationItems: [
            {
              commentsHeaderRenderer: {
                countText: runs('1.234', ' bình luận'),
                sortMenu: {
                  sortFilterSubMenuRenderer: {
                    subMenuItems: [
                      { title: 'Bình luận hàng đầu', serviceEndpoint: { continuationCommand: { token: 'SORT_TOP' } } },
                      { title: 'Mới nhất', serviceEndpoint: { continuationCommand: { token: 'SORT_NEW' } } },
                    ],
                  },
                },
                createRenderer: { commentSimpleboxRenderer: { submitButton: { buttonRenderer: { serviceEndpoint: { createCommentEndpoint: { createCommentParams: 'CREATE_PARAMS' } } } } } },
              },
            },
          ],
        },
      },
      {
        reloadContinuationItemsCommand: {
          continuationItems: [
            {
              commentThreadRenderer: {
                commentViewModel: { commentViewModel: { commentKey: 'KEY1', toolbarStateKey: 'STATE1', toolbarSurfaceKey: 'SURF1', commentId: 'Ugx1', pinnedText: 'Đã ghim' } },
                replies: { commentRepliesRenderer: { contents: [token('REPLIES1')] } },
              },
            },
            token('NEXT_COMMENTS'),
          ],
        },
      },
    ],
    frameworkUpdates: {
      entityBatchUpdate: {
        mutations: [
          {
            entityKey: 'KEY1',
            payload: {
              commentEntityPayload: {
                properties: { commentId: 'Ugx1', content: { content: 'Hay quá 0:42' }, publishedTime: '2 ngày trước' },
                author: { displayName: '@nguoidung', avatarThumbnailUrl: '//yt3.ggpht.com/a', channelId: 'UCauthor', isCreator: true },
                toolbar: { likeCountNotliked: '12', likeCountLiked: '13', replyCount: '3' },
              },
            },
          },
          { entityKey: 'STATE1', payload: { engagementToolbarStateEntityPayload: { likeState: 'TOOLBAR_LIKE_STATE_LIKED', heartState: 'TOOLBAR_HEART_STATE_HEARTED' } } },
          {
            entityKey: 'SURF1',
            payload: {
              engagementToolbarSurfaceEntityPayload: {
                likeCommand: { innertubeCommand: { performCommentActionEndpoint: { action: 'LIKE_ACTION' } } },
                unlikeCommand: { innertubeCommand: { performCommentActionEndpoint: { action: 'UNLIKE_ACTION' } } },
                replyCommand: { innertubeCommand: { createCommentReplyDialogEndpoint: { dialog: { createReplyParams: 'REPLY_PARAMS' } } } },
              },
            },
          },
        ],
      },
    },
  })

  it('joins view models with their entities', () => {
    const { page, sortOptions } = parseComments(json)
    assert.deepEqual(sortOptions, [{ title: 'Bình luận hàng đầu', token: 'SORT_TOP' }, { title: 'Mới nhất', token: 'SORT_NEW' }])
    assert.equal(page.countText, '1.234 bình luận')
    assert.equal(page.continuation, 'NEXT_COMMENTS')
    assert.equal(page.createParams, 'CREATE_PARAMS')
    assert.equal(page.comments.length, 1)
    const c = page.comments[0]
    assert.equal(c.id, 'Ugx1')
    assert.equal(c.authorName, '@nguoidung')
    assert.equal(c.authorAvatar, 'https://yt3.ggpht.com/a')
    assert.equal(c.text, 'Hay quá 0:42')
    assert.equal(c.likeCountText, '12')
    assert.equal(c.likeCountLikedText, '13')
    assert.equal(c.replyCountText, '3')
    assert.equal(c.repliesToken, 'REPLIES1')
    assert.equal(c.isPinned, true)
    assert.equal(c.isCreator, true)
    assert.equal(c.isHearted, true)
    assert.equal(c.likeState, 'LIKED')
    assert.equal(c.likeToken, 'LIKE_ACTION')
    assert.equal(c.unlikeToken, 'UNLIKE_ACTION')
    assert.equal(c.dislikeToken, null)
    assert.equal(c.replyParams, 'REPLY_PARAMS')
  })
})

describe('channel, posts, about and playlist parsers', () => {
  it('reads the new channel header and tab params', () => {
    const json = new JNode({
      header: {
        pageHeaderRenderer: {
          pageTitle: 'Kênh Thử',
          content: {
            pageHeaderViewModel: {
              title: { dynamicTextViewModel: { text: { content: 'Kênh Thử' } } },
              image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/c', width: 160 }] } } } } },
              banner: { imageBannerViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/banner', width: 2560 }] } } },
              metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '@kenhthu' } }] }, { metadataParts: [{ text: { content: '1,2 Tr người đăng ký' } }, { text: { content: '345 video' } }] }] } },
              description: { descriptionPreviewViewModel: { description: { content: 'Giới thiệu kênh' }, rendererContext: { commandContext: { onTap: { innertubeCommand: { showEngagementPanelEndpoint: { engagementPanel: { engagementPanelSectionListRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [token('ABOUT_TOKEN')] } }] } } } } } } } } } } },
            },
          },
        },
      },
      metadata: { channelMetadataRenderer: { externalId: 'UCkenhthu000000000000001', title: 'Kênh Thử' } },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            { tabRenderer: { endpoint: { browseEndpoint: { params: 'VIDEOS_P' }, commandMetadata: { webCommandMetadata: { url: '/@kenhthu/videos' } } }, selected: true, content: { richGridRenderer: { contents: [{ richItemRenderer: { content: { videoRenderer: { videoId: 'CHVIDEO0001', title: runs('V') } } } }, token('GRID_NEXT')] } } } },
            { tabRenderer: { endpoint: { browseEndpoint: { params: 'POSTS_P' }, commandMetadata: { webCommandMetadata: { url: '/@kenhthu/community' } } } } },
            { tabRenderer: { endpoint: { browseEndpoint: { params: 'SHORTS_P' }, commandMetadata: { webCommandMetadata: { url: '/@kenhthu/shorts' } } } } },
            { expandableTabRenderer: { title: 'Tìm kiếm' } },
          ],
        },
      },
      frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { subscriptionStateEntity: { subscribed: true } } }] } },
    })
    const page = parseChannel(json, '@kenhthu', 'videos', true)
    assert.deepEqual(page.channel, { id: 'UCkenhthu000000000000001', name: 'Kênh Thử', avatar: 'https://yt3.ggpht.com/c', handle: '@kenhthu', subscriberText: '1,2 Tr người đăng ký', videoCountText: '345 video' })
    assert.equal(page.banner, 'https://yt3.ggpht.com/banner')
    assert.equal(page.description, 'Giới thiệu kênh')
    assert.deepEqual(page.tabParams, { videos: 'VIDEOS_P', posts: 'POSTS_P', shorts: 'SHORTS_P' })
    assert.deepEqual(feedVideos(page.initialPage).map((v) => v.id), ['CHVIDEO0001'])
    assert.equal(page.initialPage.continuation, 'GRID_NEXT')
    assert.equal(page.aboutToken, 'ABOUT_TOKEN')
    assert.equal(page.isSubscribed, true)
    assert.equal(parseChannel(json, 'x', 'videos', false).isSubscribed, null)
  })

  it('reads posts and the about panel', () => {
    const posts = parsePosts(new JNode({
      contents: [
        { backstagePostThreadRenderer: { post: { backstagePostRenderer: { postId: 'P1', authorText: runs('Kênh'), contentText: runs('Xin chào ', 'mọi người'), publishedTimeText: runs('1 ngày trước'), voteCount: { simpleText: '1,2 N' }, backstageAttachment: { pollRenderer: { choices: [{ text: runs('Có') }, { text: runs('Không') }], totalVotes: { simpleText: '100 phiếu bầu' } } } } } } },
        { backstagePostThreadRenderer: { post: { backstagePostRenderer: { postId: 'P2', contentText: runs('Ảnh'), backstageAttachment: { postMultiImageRenderer: { images: [{ backstageImageRenderer: { image: thumbs('https://yt3.ggpht.com/i1', 1000) } }, { backstageImageRenderer: { image: thumbs('https://yt3.ggpht.com/i2', 1000) } }] } } } } } },
        token('POSTS_NEXT'),
      ],
    }))
    assert.equal(posts.posts.length, 2)
    assert.equal(posts.posts[0].text, 'Xin chào mọi người')
    assert.deepEqual(posts.posts[0].attachment, { type: 'poll', choices: ['Có', 'Không'], totalVotes: '100 phiếu bầu' })
    assert.deepEqual(posts.posts[1].attachment, { type: 'images', urls: ['https://yt3.ggpht.com/i1', 'https://yt3.ggpht.com/i2'] })
    assert.equal(posts.continuation, 'POSTS_NEXT')

    const about = parseAbout(new JNode({
      onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: [{ aboutChannelRenderer: { metadata: { aboutChannelViewModel: {
        description: 'Mô tả', country: 'Việt Nam', subscriberCountText: '1,2 Tr người đăng ký', viewCountText: '100.000.000 lượt xem', videoCountText: '345 video', joinedDateText: { content: 'Đã tham gia 1 thg 1, 2015' }, canonicalChannelUrl: 'http://www.youtube.com/@kenhthu',
        links: [{ channelExternalLinkViewModel: { title: { content: 'Facebook' }, link: { content: 'facebook.com/kenhthu', commandRuns: [{ onTap: { innertubeCommand: { urlEndpoint: { url: 'https://www.youtube.com/redirect?event=channel&q=https%3A%2F%2Ffacebook.com%2Fkenhthu' } } } }] } } }],
      } } } }] } }],
    }))!
    assert.equal(about.country, 'Việt Nam')
    assert.equal(about.joinedDateText, 'Đã tham gia 1 thg 1, 2015')
    assert.deepEqual(about.links, [{ title: 'Facebook', displayUrl: 'facebook.com/kenhthu', url: 'https://facebook.com/kenhthu' }])
  })

  it('reads a playlist page', () => {
    const page = parsePlaylist(new JNode({
      header: { pageHeaderRenderer: { pageTitle: 'Danh sách của tôi', content: { pageHeaderViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ avatarStack: { avatarStackViewModel: { text: { content: 'bởi Người tạo' } } } }] }] } } } } } },
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents: [
        { playlistVideoRenderer: { videoId: 'PLVIDEO0001', title: runs('Một'), shortBylineText: runs('Kênh'), lengthSeconds: '200', videoInfo: runs('1,2 Tr lượt xem', ' • ', '2 năm trước') } },
        token('PL_NEXT'),
      ] } }] } }] } } } }] } },
    }), 'PLabc')
    assert.equal(page.playlist.title, 'Danh sách của tôi')
    assert.equal(page.playlist.channelName, 'bởi Người tạo')
    const [video] = feedVideos(page.page)
    assert.equal(video.durationSeconds, 200)
    assert.equal(video.viewCountText, '1,2 Tr lượt xem')
    assert.equal(video.publishedText, '2 năm trước')
    assert.equal(page.page.continuation, 'PL_NEXT')
  })
})

describe('account parsers', () => {
  it('reads the profile, switcher, playlists and notifications', () => {
    const profile = parseProfile(new JNode({
      actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: {
        header: { activeAccountHeaderRenderer: { accountName: { simpleText: 'Đặng Văn D' }, email: { simpleText: 'd@example.com' }, channelHandle: { simpleText: '@dangvd' }, accountPhoto: thumbs('https://yt3.ggpht.com/me', 88) } },
        sections: [{ multiPageMenuSectionRenderer: { items: [{ compactLinkRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'UCmine000000000000000001' } } } }] } }],
      } } } }],
    }))
    assert.deepEqual(profile, { name: 'Đặng Văn D', handle: '@dangvd', email: 'd@example.com', avatar: 'https://yt3.ggpht.com/me', channelId: 'UCmine000000000000000001' })

    const identities = parseIdentities(new JNode({
      data: { actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [
        { accountSectionListRenderer: {
          header: { googleAccountHeaderRenderer: { email: { simpleText: 'd@example.com' } } },
          contents: [{ accountItemSectionRenderer: { contents: [
            { accountItem: { accountName: { simpleText: 'Đặng' }, accountPhoto: thumbs('https://yt3.ggpht.com/1', 88), isSelected: true, channelHandle: { simpleText: '@dang' }, hasChannel: true, serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ accountStateToken: {} }, { accountSigninToken: { signinUrl: '/signin?action_handle_signin=true&authuser=0' } }] } } } },
            { accountItem: { accountName: { simpleText: 'Kênh Thương Hiệu' }, accountByline: { simpleText: '12 người đăng ký' }, isSelected: false, serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ pageIdToken: { pageId: '1234567890' } }, { accountSigninToken: { signinUrl: 'https://www.youtube.com/signin?authuser=0&pageid=1234567890' } }] } } } },
          ] } }],
        } },
        { accountSectionListRenderer: {
          header: { googleAccountHeaderRenderer: { email: { simpleText: 'second@example.com' } } },
          contents: [{ accountItemSectionRenderer: { contents: [
            { accountItem: { accountName: { simpleText: 'Tài khoản 2' }, serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ accountSigninToken: { signinUrl: '/signin?authuser=1' } }] } } } },
          ] } }],
        } },
      ] } } } }] },
    }))
    assert.deepEqual(identities.map((i) => [i.id, i.name, i.email, i.isSelected]), [
      ['0|', 'Đặng', 'd@example.com', true],
      ['0|1234567890', 'Kênh Thương Hiệu', 'd@example.com', false],
      ['1|', 'Tài khoản 2', 'second@example.com', false],
    ])
    assert.equal(identities[1].byline, '12 người đăng ký')

    assert.deepEqual(parsePlaylistOptions(new JNode({ contents: [{ addToPlaylistRenderer: { playlists: [
      { playlistAddToOptionRenderer: { playlistId: 'WL', title: { simpleText: 'Xem sau' }, containsSelectedVideos: 'NONE' } },
      { playlistAddToOptionRenderer: { playlistId: 'PL1', title: { simpleText: 'Nhạc' }, containsSelectedVideos: 'ALL' } },
    ] } }] })), [{ id: 'WL', title: 'Xem sau', containsVideo: false }, { id: 'PL1', title: 'Nhạc', containsVideo: true }])

    const notifications = parseNotifications(new JNode({ actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { sections: [{ multiPageMenuNotificationSectionRenderer: { items: [
      { notificationRenderer: { notificationId: 'N1', shortMessage: runs('Kênh A đã tải lên: Video mới'), sentTimeText: runs('3 giờ trước'), thumbnail: thumbs('https://yt3.ggpht.com/a', 88), videoThumbnail: thumbs('https://i.ytimg.com/vi/x/hq.jpg'), read: false, navigationEndpoint: { watchEndpoint: { videoId: 'NOTIFVIDEO1' } } } },
    ] } }] } } } }] }))
    assert.deepEqual(notifications[0], { id: 'N1', message: 'Kênh A đã tải lên: Video mới', timeText: '3 giờ trước', avatar: 'https://yt3.ggpht.com/a', thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg', videoId: 'NOTIFVIDEO1', isRead: false })
  })
})

describe('live chat parser', () => {
  it('reads messages, paid messages, removals and the next token', () => {
    const chunk = parseLiveChat(new JNode({
      continuationContents: { liveChatContinuation: {
        continuations: [{ invalidationContinuationData: { continuation: 'NEXT_CHAT', timeoutMs: 10000 } }],
        actions: [
          { addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'm1', message: { runs: [{ text: 'Xin chào ' }, { emoji: { emojiId: '😀', shortcuts: [':grinning:'] } }, { emoji: { isCustomEmoji: true, shortcuts: [':yt:'] } }] }, authorName: { simpleText: 'Ai đó' }, authorPhoto: { thumbnails: [{ url: 'https://yt4.ggpht.com/p', width: 64 }] }, authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' } } }] } } } },
          { addChatItemAction: { item: { liveChatPaidMessageRenderer: { id: 'm2', purchaseAmountText: { simpleText: '₫50.000' }, authorName: { simpleText: 'B' }, authorBadges: [{ liveChatAuthorBadgeRenderer: { customThumbnail: { thumbnails: [] } } }] } } } },
          { markChatItemAsDeletedAction: { targetItemId: 'old' } },
        ],
        actionPanel: { liveChatMessageInputRenderer: { sendButton: { buttonRenderer: { serviceEndpoint: { sendLiveChatMessageEndpoint: { params: 'SEND_PARAMS' } } } } } },
      } },
    }))
    assert.equal(chunk.continuation, 'NEXT_CHAT')
    assert.equal(chunk.timeoutMs, 10000)
    assert.equal(chunk.sendParams, 'SEND_PARAMS')
    assert.deepEqual(chunk.removedIds, ['old'])
    assert.deepEqual(chunk.messages[0], { id: 'm1', author: 'Ai đó', authorPhoto: 'https://yt4.ggpht.com/p', message: 'Xin chào 😀:yt:', amount: null, isOwner: false, isModerator: true, isMember: false, offsetMs: null })
    assert.equal(chunk.messages[1].amount, '₫50.000')
    assert.equal(chunk.messages[1].isMember, true)
  })

  it('reads replay chunks with their video offsets', () => {
    const chunk = parseLiveChat(new JNode({
      continuationContents: { liveChatContinuation: {
        continuations: [{ liveChatReplayContinuationData: { continuation: 'REPLAY_NEXT' } }, { playerSeekContinuationData: { continuation: 'SEEK' } }],
        actions: [{ replayChatItemAction: { videoOffsetTimeMsec: '61000', actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'r1', message: { simpleText: 'cũ' }, authorName: { simpleText: 'X' } } } } }] } }],
      } },
    }))
    assert.equal(chunk.continuation, 'REPLAY_NEXT')
    assert.equal(chunk.seekContinuation, 'SEEK')
    assert.equal(chunk.messages[0].offsetMs, 61000)
  })

  it('cuts ytInitialData out of the chat frame (object or JS string)', () => {
    const html = `<script>window["ytInitialData"] = {"contents":{"liveChatRenderer":{"actions":[],"continuations":[{"timedContinuationData":{"continuation":"T1","timeoutMs":5000}}]}},"s":"}{"};</script>`
    assert.equal(parseLiveChat(initialData(html)!).continuation, 'T1')
    const escaped = `<script>var ytInitialData = '\\x7b\\x22a\\x22:\\x22Vi\\u1ec7t\\x22\\x7d';</script>`
    assert.equal(initialData(escaped)!.get('a').string, 'Việt')
    assert.equal(initialData('<html>nothing</html>'), null)
  })
})

describe('aux parsers', () => {
  it('reads channel RSS feeds', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Kênh &amp; Bạn</title>
 <author><name>Kênh &amp; Bạn</name></author>
 <entry>
  <id>yt:video:RSSVIDEO001</id>
  <yt:videoId>RSSVIDEO001</yt:videoId>
  <title>Video &quot;mới&quot;</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/RSSVIDEO001"/>
  <author><name>Kênh &amp; Bạn</name></author>
  <published>2026-10-20T10:00:00+00:00</published>
  <media:group><media:title>Video "mới"</media:title><media:thumbnail url="https://i2.ytimg.com/vi/RSSVIDEO001/hqdefault.jpg" width="480" height="360"/>
  <media:community><media:statistics views="12345"/></media:community></media:group>
 </entry>
</feed>`
    const [video] = parseRss(xml, 'UCrss', Date.parse('2026-10-22T10:00:00Z'))
    assert.equal(video.id, 'RSSVIDEO001')
    assert.equal(video.title, 'Video "mới"')
    assert.equal(video.channelName, 'Kênh & Bạn')
    assert.equal(video.thumbnail, 'https://i2.ytimg.com/vi/RSSVIDEO001/hqdefault.jpg')
    assert.equal(video.publishedDate, Date.parse('2026-10-20T10:00:00Z'))
    assert.equal(video.publishedText, '2 ngày trước')
    assert.equal(video.viewCountText, '12 N lượt xem')
    assert.equal(video.isShort, true)
  })

  it('reads SponsorBlock, captions and relative dates', () => {
    assert.deepEqual(parseSponsorSegments(new JNode([
      { videoID: 'other', segments: [] },
      { videoID: 'dQw4w9WgXcQ', segments: [{ segment: [30.5, 40], category: 'selfpromo', actionType: 'skip' }, { segment: [1, 5], category: 'sponsor' }, { segment: [50, 55], category: 'poi_highlight', actionType: 'poi' }] },
    ]), 'dQw4w9WgXcQ'), [{ start: 1, end: 5, category: 'sponsor' }, { start: 30.5, end: 40, category: 'selfpromo' }])
    assert.deepEqual(parseCaptions(new JNode({ events: [{ tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Xin ' }, { utf8: 'chào' }] }, { tStartMs: 1500, segs: [{ utf8: '\n' }] }, { tStartMs: 2000, segs: [{ utf8: 'B' }] }] })), [
      { start: 0, end: 1.5, text: 'Xin chào' },
      { start: 2, end: 4, text: 'B' },
    ])
    const now = Date.parse('2026-10-24T00:00:00Z')
    assert.equal(relativeDate('3 ngày trước', now), now - 3 * 86_400_000)
    assert.equal(relativeDate('2 weeks ago', now), now - 2 * 604_800_000)
    assert.equal(relativeDate('Đã phát trực tiếp', now), null)
  })
})
