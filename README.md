# B-Roll Studio MCP server

Lets **Claude Code** turn a topic into real b-roll on an editor timeline:
**search → download → judge → place on a timeline**. Talks to the hosted
B-Roll Studio API; needs only a personal API key.

## Tools

| Tool | What it does |
|------|--------------|
| `search_broll` | Real, relevant assets (images, stock video, YouTube, tweets, articles), each with a downloadable file. Supports mix weights + aspect ratio. |
| `download_asset` | Saves an asset to a local file. |
| `place_in_resolve` | Direct to timeline (DaVinci Resolve): appends clips to your open timeline live. |
| `build_premiere_script` | Direct to timeline (Premiere): writes a `.jsx` that appends clips to your active sequence. |
| `build_timeline` | Universal fallback: writes FCPXML + EDL + manifest for any editor. |

## Setup (any machine — no clone, no GitHub login)

Needs **Node 18+** and the **Claude Code** CLI. Get a key from
B-Roll Studio → **Settings → API keys**, then:

```bash
npm install -g github:Gaffattack54/broll-studio-mcp

claude mcp add broll-studio broll-studio-mcp -s user \
  -e BROLL_API_KEY=brs_live_your_key \
  -e BROLL_API_BASE=https://broll-studio-ten.vercel.app
```

Verify: `claude mcp list` → `broll-studio: ✓ Connected`. The server is now
available in **every** Claude Code project on that machine.

> Use one key per machine so you can revoke a single machine in Settings without
> affecting the others.

## Use it

Open Claude Code in any project and ask:

> Find 6 vertical b-roll clips and images of the New York City skyline, download
> the good ones to `D:/edit/nyc`, and build a timeline there.

## Notes

- Only **images and stock video** download as the actual media. Tweets and
  articles render to image cards; YouTube returns its thumbnail still (with the
  watch link in `page_url`).
- `place_in_resolve` needs Resolve running with *Preferences → System → General →
  External scripting using = Local*, and Python 3 installed.
