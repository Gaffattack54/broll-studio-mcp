# Project guidance for Claude Code

## B-Roll Studio (connected via MCP)

When this project needs real b-roll for an edit, use the **B-Roll Studio** MCP
tools — never use placeholders, made-up links, or generic filler.

### Tools
- `search_broll(query, weights?, aspect?)` — turn a topic or a transcript moment
  into real, embeddable assets.
  - `weights`: 0–3 per type `{image, stock_video, footage, tweet, article}`.
    0 excludes a type. Lean on `image` + `stock_video` for cutaways.
  - `aspect`: `"landscape"` (16:9), `"portrait"` (9:16), `"square"` (1:1), `"any"`.
- `download_asset(url, dir)` — download the promising results to local files.
  Images and stock video are the real media; tweets/articles come back as image
  cards; YouTube is a thumbnail still (the moving clip is the link in `page_url`).
- `place_in_resolve(clips)` — append clips to the OPEN DaVinci Resolve timeline.
- `build_premiere_script(out_dir, clips)` — write a `.jsx` to append clips to the
  active Premiere sequence.
- `build_timeline(out_dir, clips)` — write FCPXML + EDL for any editor.

### Workflow (always follow this order)
1. **Search** for each moment/topic with a specific query.
2. **Download** the promising candidates.
3. **Judge** — actually look at each downloaded asset and keep only the ones that
   genuinely fit the moment. Drop anything off-topic, low-quality, or repetitive.
   Do not put junk on the timeline.
4. **Place** the keepers:
   - If DaVinci Resolve is open → `place_in_resolve`.
   - Else if using Premiere → `build_premiere_script`, then tell me to run the `.jsx`.
   - Else → `build_timeline` and tell me to import the FCPXML/EDL.

### Defaults for this project
- **Aspect ratio:** 16:9 (`landscape`). Use `portrait` (9:16) only when I say it's
  a vertical/Shorts edit.
- **Editors:** DaVinci Resolve and Premiere Pro (prefer Resolve if it's running).
- **Downloads folder:** `./broll` in the project (create it if missing).
- **Per moment:** pull ~8–10 candidates, then narrow to the best 2–3.
- Prefer real, on-topic footage over generic stock. When in doubt, show me the
  options before committing them to the timeline.
