"""Temporary diagnostics for the live chat endpoints (anonymous requests only)."""
import json, re, sys, urllib.request, urllib.error, http.cookiejar

SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"
CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
VERSION = "2.20261019.01.00"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def req(url, body=None, ua=SAFARI, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers={"User-Agent": ua, "Accept-Language": "vi,en;q=0.9", **(headers or {})})
    if data: r.add_header("Content-Type", "application/json")
    try:
        with opener.open(r, timeout=20) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def ctx(hl="vi", gl="VN"):
    return {"client": {"clientName": "WEB", "clientVersion": VERSION, "hl": hl, "gl": gl}}

def find(o, k):
    if isinstance(o, dict):
        for kk, v in o.items():
            if kk == k: yield v
            else: yield from find(v, k)
    elif isinstance(o, list):
        for i in o: yield from find(i, k)

def initial_data(html):
    m = re.search(r'ytInitialData"?\]?\s*=\s*', html)
    if not m: return None, "no marker"
    start = m.end()
    if html[start] != "{": return None, "after marker: " + repr(html[start:start+200])
    dec = json.JSONDecoder()
    try:
        obj, _ = dec.raw_decode(html[start:])
        return obj, "ok"
    except Exception as e:
        return None, f"json error {e}"

video = sys.argv[1] if len(sys.argv) > 1 else None
if not video:
    s, b = req("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {"context": ctx(), "query": "lofi", "params": "EgJAAQ%3D%3D"})
    vids = [v for v in find(json.loads(b), "videoId")]
    video = vids[0]
print("video", video)

s, b = req("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {"context": ctx(), "videoId": video})
nxt = json.loads(b)
lcr = nxt.get("contents", {}).get("twoColumnWatchNextResults", {}).get("conversationBar", {}).get("liveChatRenderer", {})
api_tokens = [i["continuation"]["reloadContinuationData"]["continuation"] for i in next(find(lcr, "subMenuItems"), [])]
api_tokens += [c["reloadContinuationData"]["continuation"] for c in lcr.get("continuations", []) if "reloadContinuationData" in c]
print("next", s, "tokens", [t[:12] + "…" + t[-8:] + f"({len(t)})" for t in api_tokens])

s, b = req(f"https://www.youtube.com/watch?v={video}&hl=vi", ua=CHROME)
html = b.decode("utf-8", "replace")
watch_data, why = initial_data(html)
print("watch page", s, len(b), why)
page_tokens = []
if watch_data:
    wl = watch_data.get("contents", {}).get("twoColumnWatchNextResults", {}).get("conversationBar", {}).get("liveChatRenderer", {})
    page_tokens = [c["reloadContinuationData"]["continuation"] for c in wl.get("continuations", []) if "reloadContinuationData" in c]
    page_tokens += [i["continuation"]["reloadContinuationData"]["continuation"] for i in next(find(wl, "subMenuItems"), [])]
    print("watch tokens", [t[:12] + "…" + t[-8:] + f"({len(t)})" for t in page_tokens], "same as api:", set(page_tokens) == set(api_tokens))
ytcfg_key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
ytcfg_ver = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html)
print("ytcfg version", ytcfg_ver and ytcfg_ver.group(1))

for label, tokens in [("api", api_tokens), ("watch", page_tokens)]:
    for token in tokens[:1]:
        for ua_name, ua in [("safari", SAFARI), ("chrome", CHROME)]:
            for url in [f"https://www.youtube.com/live_chat?continuation={token}", f"https://www.youtube.com/live_chat?is_popout=1&v={video}"]:
                s, b = req(url, ua=ua)
                h = b.decode("utf-8", "replace")
                title = re.search(r"<title>(.*?)</title>", h, re.S)
                data, why = initial_data(h)
                print(f"chat page [{label} token, {ua_name}] {url[24:60]}… -> {s} {len(b)}B title={title and title.group(1)[:60]!r} data={why}")
                if data:
                    cont = data.get("continuationContents", {}).get("liveChatContinuation") or data.get("contents", {}).get("liveChatRenderer") or {}
                    print("   keys:", list(data.keys())[:8], "chat keys:", list(cont.keys())[:10], "actions:", len(cont.get("actions", [])))
                    conts = cont.get("continuations", [])
                    print("   continuations:", [list(c.keys()) for c in conts])
                    poll = next((v["continuation"] for c in conts for v in c.values() if isinstance(v, dict) and "continuation" in v), None)
                    if poll:
                        s2, b2 = req("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false", {"context": ctx(), "continuation": poll}, ua=ua)
                        j2 = json.loads(b2)
                        lc2 = j2.get("continuationContents", {}).get("liveChatContinuation", {})
                        print("   poll with page token ->", s2, "actions", len(lc2.get("actions", [])), j2.get("error", {}).get("message"))
        s, b = req("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false", {"context": ctx(), "continuation": token})
        print(f"api get_live_chat [{label} token] ->", s, json.loads(b).get("error", {}).get("message") if s != 200 else f"actions {len(json.loads(b).get('continuationContents', {}).get('liveChatContinuation', {}).get('actions', []))}")
        s, b = req("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false", {"context": ctx("en", "US"), "continuation": token})
        print(f"api get_live_chat [{label} token, en/US] ->", s, json.loads(b).get("error", {}).get("message") if s != 200 else "ok")
        if "%" in token:
            from urllib.parse import unquote
            s, b = req("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false", {"context": ctx(), "continuation": unquote(token)})
            print(f"api get_live_chat [{label} token unquoted] ->", s, json.loads(b).get("error", {}).get("message") if s != 200 else "ok")
