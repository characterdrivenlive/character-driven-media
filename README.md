# CharacterDriven.live Studio — Tabbed Recreation (~2010 schema)

Modern HTML5 / WebRTC recreation of the early Mogulus / CharacterDriven.live Studio interface, updated to the tabbed production layout that appeared after the 2009 rebrand (roughly 2010).

## Original Functions Covered

From Mogulus (2007) through early CharacterDriven.live Studio:

| Function | Status in this build |
|----------|----------------------|
| Broadcast Live (webcam + clips) | Working (getUserMedia + File API) |
| Sources switching / Cue | Working |
| Storyboards | Working (structure persisted) |
| Auto-pilot | Working (advances on clip end) |
| Lower Third | Working + broadcast to viewer |
| Scrolling Ticker | Working + broadcast |
| Over-the-Shoulder graphic | Working |
| Corner Bug (logo) | Working |
| Test Card | Working |
| Channel Style (name, accent color) | Working + persisted |
| Chat | Working (BroadcastChannel multi-user sketch) |
| Who's Watching | Simulated viewer count |
| Get Player / Embed | Local viewer link + iframe snippet |
| Record | Local simulation |
| Library | Working (session clips) |
| Persistence | localStorage for settings + storyboard structure |

## Tabbed Interface (~2010 schema)

- **Broadcast Live** — Sources, Program monitor, Take, Auto-pilot toggle, Record
- **Overlays** — Lower Third, Ticker, OTS, Corner Bug, Test Card
- **Auto-pilot** — Storyboard playlist control
- **Library** — Uploaded media
- **Chat** — Local chat + Who's Watching
- **Channel Style** — Name, strap, accent color
- **Get Player** — Embed snippet + viewer link

## Most Efficient Way to Run This

### 1. Local (immediate, zero infrastructure)
Just open `index.html` in any modern browser.  
Open `viewer.html` in a second tab for the multi-user sketch (BroadcastChannel).

### 2. GitHub Pages (recommended for free static hosting)
```bash
# Create a repo, push the characterdriven.live-studio-v2 folder contents to the root or /docs
# Enable GitHub Pages (Settings → Pages → Deploy from branch)
```
Result: public URL, no server cost, perfect for the static UI.

### 3. Railway (if you want a simple Node static server or later backend)
```bash
# railway.toml or just use the static site template
# Point Railway at the folder containing index.html
```
Railway is efficient for:
- Static site (current app)
- Adding a lightweight Node/Express or Fastify backend later for real WebRTC signaling, multi-user state, or HLS output

### 4. Full production infrastructure (when you need real multi-user + public streaming)
For true multi-producer collaboration and public live streaming matching the original Mogulus model:

- **Frontend**: This static app (or Next.js/SvelteKit version)
- **Signaling / real-time state**: Railway + Socket.io, or Supabase Realtime, or Firebase
- **Media**: 
  - WebRTC (peer or SFU like LiveKit / mediasoup) for low-latency multi-camera
  - Or RTMP ingest → HLS/DASH for scalable audience playback
- **Storage**: S3-compatible for clips and VOD
- **CDN**: Cloudflare or similar for player delivery

**Most efficient starting point today**:
1. Deploy the current static files to **GitHub Pages** or **Railway** static.
2. Use it locally or via the public URL for the full tabbed UI and BroadcastChannel multi-user sketch.
3. When you need real cross-device streaming and persistent multi-producer control, add a Railway Node service with LiveKit or a simple Socket.io + WebRTC signaling layer. The UI schema is already structured for that.

## Limitations of the Current Build
- Uploaded video object URLs are session-only (re-upload after refresh; storyboard structure is saved).
- BroadcastChannel multi-user is same-browser only.
- No actual public CDN stream or cross-device video (control messages only).
- Browser webcam only (no multi-hardware capture).

## Files
- `index.html` — Tabbed Studio
- `viewer.html` — Audience viewer
- `README.md` — This file

Open `index.html` to start. All core Mogulus/CharacterDriven.live Studio functions listed above are implemented and work in the browser.
