#!/usr/bin/env node
// B-Roll Studio MCP server.
//
// Tools (for Claude Code):
//   search_broll   — query B-Roll Studio's API for real, relevant b-roll
//   download_asset — save a returned asset URL to a local file
//   build_timeline — emit FCPXML + EDL + manifest from chosen clips
//
// The "is this asset actually good?" judgement is left to Claude itself: it
// downloads candidates, looks at them against the moment, keeps the good ones,
// then calls build_timeline with the survivors.
//
// Env:
//   BROLL_API_KEY   (required)  a brs_live_… key from Settings → API keys
//   BROLL_API_BASE  (optional)  defaults to https://broll-studio-ten.vercel.app
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";
import { buildFcpxml, buildEdl, buildManifest } from "./timeline.mjs";
import { buildPremiereJsx } from "./premiere.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Run a Python helper, trying common interpreter names. Resolves to the helper's
// parsed JSON (helpers always print one JSON line), or a structured error.
function runPython(scriptPath, argsArray) {
  const candidates = [process.env.PYTHON, "python", "py", "python3"].filter(Boolean);
  return new Promise((resolve) => {
    const attempt = (i) => {
      if (i >= candidates.length) {
        return resolve({ ok: false, error: "python_not_found", detail: "Install Python 3 or set the PYTHON env var." });
      }
      let out = "";
      let err = "";
      let child;
      try {
        child = spawn(candidates[i], [scriptPath, JSON.stringify(argsArray)]);
      } catch {
        return attempt(i + 1);
      }
      child.on("error", (e) => (e.code === "ENOENT" ? attempt(i + 1) : resolve({ ok: false, error: "spawn_failed", detail: e.message })));
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => {
        const line = out.trim().split("\n").filter(Boolean).pop();
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve({ ok: false, error: "bad_output", detail: (out || err || `exit ${code}`).slice(0, 600) });
        }
      });
    };
    attempt(0);
  });
}

const API_BASE = (process.env.BROLL_API_BASE || "https://broll-studio-ten.vercel.app").replace(/\/$/, "");
const API_KEY = process.env.BROLL_API_KEY || "";

function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}
function fail(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const server = new McpServer({ name: "broll-studio", version: "1.0.0" });

server.tool(
  "search_broll",
  "Search B-Roll Studio for real, embeddable b-roll for a topic or moment. Returns assets with direct, downloadable URLs (images: full_url, stock video: video_url). Use the weights to bias the mix (0=off..3=heavy) and aspect to set the frame shape.",
  {
    query: z.string().describe("What the b-roll should depict, e.g. 'New York City skyline at dusk'."),
    weights: z
      .object({
        image: z.number().min(0).max(3).optional(),
        stock_video: z.number().min(0).max(3).optional(),
        footage: z.number().min(0).max(3).optional(),
        tweet: z.number().min(0).max(3).optional(),
        article: z.number().min(0).max(3).optional(),
      })
      .optional()
      .describe("Per-type emphasis 0..3. Omit for an even mix. Set a type to 0 to exclude it."),
    aspect: z
      .enum(["any", "landscape", "portrait", "square"])
      .optional()
      .describe("Frame shape for images + stock video. 'landscape'=16:9, 'portrait'=9:16, 'square'=1:1."),
  },
  async ({ query, weights, aspect }) => {
    if (!API_KEY) return fail("BROLL_API_KEY is not set. Create one in Settings → API keys.");
    try {
      const res = await fetch(`${API_BASE}/api/v1/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ query, weights, aspect }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        return fail(`Search failed (${res.status}): ${data.error || "unknown error"}`);
      }
      // Trim to the fields an agent needs to download + judge. The API supplies
      // download_url + media_kind for every type: images/stock-video are the
      // real media; tweets/articles render to PNG cards; YouTube gives its
      // thumbnail still (page_url keeps the watch link to the moving clip).
      const items = (data.items || []).map((it) => ({
        type: it.type,
        media_kind: it.media_kind ?? (it.full_url || it.video_url ? "image" : "link"),
        context: it.context,
        query: it.query,
        download_url: it.download_url ?? it.full_url ?? it.video_url ?? null,
        preview_url: it.thumbnail_url || it.full_url || it.download_url || null,
        page_url: it.page_url || it.watch_url || it.tweet_url || it.url || null,
        width: it.width ?? null,
        height: it.height ?? null,
        duration: it.duration ?? null,
      }));
      return ok({ query: data.query, count: items.length, items });
    } catch (e) {
      return fail(`Search error: ${e.message}`);
    }
  },
);

server.tool(
  "download_asset",
  "Download a single asset URL (from search_broll's download_url) to a local file so it can be inspected and used on a timeline. Every asset type returns something downloadable: images, stock video, tweet/article cards, and YouTube thumbnail stills. For YouTube, page_url is the link to the actual moving clip.",
  {
    url: z.string().url().describe("The asset's download_url."),
    dir: z.string().describe("Absolute directory to save into. Created if missing."),
    filename: z.string().optional().describe("Optional filename. Defaults to a name derived from the URL."),
  },
  async ({ url, dir, filename }) => {
    try {
      await mkdir(dir, { recursive: true });
      const res = await fetch(url);
      if (!res.ok || !res.body) return fail(`Download failed (${res.status}) for ${url}`);
      const ct = res.headers.get("content-type") || "";
      let name = filename || basename(new URL(url).pathname) || "asset";
      if (!extname(name)) {
        name += ct.includes("video") ? ".mp4" : ct.includes("png") ? ".png" : ".jpg";
      }
      const dest = join(dir, name);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      const bytes = Number(res.headers.get("content-length")) || null;
      return ok({ saved: dest, content_type: ct, bytes });
    } catch (e) {
      return fail(`Download error: ${e.message}`);
    }
  },
);

server.tool(
  "build_timeline",
  "Write an editor timeline from chosen, already-downloaded clips. Emits timeline.fcpxml (Final Cut / DaVinci Resolve / Premiere), timeline.edl (universal fallback), and manifest.json into the output directory. Clips are laid end-to-end as a rough assembly.",
  {
    out_dir: z.string().describe("Absolute directory to write the timeline files into. Created if missing."),
    title: z.string().optional().describe("Timeline/project name."),
    clips: z
      .array(
        z.object({
          path: z.string().describe("Absolute path to the downloaded media file."),
          name: z.string().optional().describe("Display name; defaults to the filename."),
          type: z.enum(["image", "video"]).optional().describe("Defaults inferred from the file extension."),
          duration: z.number().positive().optional().describe("Seconds on the timeline. Stills default to 5s, video to 8s."),
        }),
      )
      .min(1)
      .describe("Ordered clips to place on the timeline."),
  },
  async ({ out_dir, title, clips }) => {
    try {
      await mkdir(out_dir, { recursive: true });
      const opts = { title: title || "B-Roll Studio Timeline" };
      const fcpxml = buildFcpxml(clips, opts);
      const edl = buildEdl(clips, opts);
      const manifest = buildManifest(clips, opts);
      const files = {
        fcpxml: join(out_dir, "timeline.fcpxml"),
        edl: join(out_dir, "timeline.edl"),
        manifest: join(out_dir, "manifest.json"),
      };
      await Promise.all([
        writeFile(files.fcpxml, fcpxml),
        writeFile(files.edl, edl),
        writeFile(files.manifest, manifest),
      ]);
      return ok({
        written: files,
        clip_count: clips.length,
        note: "Import timeline.fcpxml in Resolve/FCP/Premiere. If a host rejects FCPXML, import timeline.edl and relink media by clip name.",
      });
    } catch (e) {
      return fail(`build_timeline error: ${e.message}`);
    }
  },
);

server.tool(
  "place_in_resolve",
  "Insert already-downloaded clips DIRECTLY onto the open DaVinci Resolve timeline — imports them into the media pool and appends to the current timeline (creating one if none is open). Requires Resolve to be running with external scripting enabled (Preferences > System > General > External scripting using = Local).",
  {
    clips: z
      .array(z.object({ path: z.string().describe("Absolute path to a downloaded media file.") }))
      .min(1)
      .describe("Downloaded clips to append, in order."),
  },
  async ({ clips }) => {
    const r = await runPython(join(HERE, "resolve_insert.py"), clips.map((c) => c.path));
    if (!r.ok) {
      const hints = {
        resolve_not_running: "Open DaVinci Resolve and enable Preferences > System > General > External scripting using = Local.",
        python_not_found: "Install Python 3, or set the PYTHON env var to your interpreter.",
        no_project: "Open or create a project in Resolve first.",
      };
      return fail(`Resolve insert failed (${r.error})${r.detail ? " — " + r.detail : ""}${hints[r.error] ? "\nFix: " + hints[r.error] : ""}`);
    }
    return ok(r);
  },
);

server.tool(
  "build_premiere_script",
  "Generate a Premiere Pro script (premiere_insert.jsx) that imports the chosen clips and appends them to your ACTIVE sequence. Run it in Premiere via File > Scripts (or the ExtendScript runner) with a project + sequence open. This is the direct-to-timeline path for Premiere.",
  {
    out_dir: z.string().describe("Absolute directory to write the .jsx into. Created if missing."),
    clips: z
      .array(
        z.object({
          path: z.string().describe("Absolute path to a downloaded media file."),
          duration: z.number().positive().optional().describe("Seconds on the timeline (stills default to 5)."),
        }),
      )
      .min(1)
      .describe("Clips to append, in order."),
  },
  async ({ out_dir, clips }) => {
    try {
      await mkdir(out_dir, { recursive: true });
      const dest = join(out_dir, "premiere_insert.jsx");
      await writeFile(dest, buildPremiereJsx(clips));
      return ok({
        written: dest,
        clip_count: clips.length,
        how_to_run: "In Premiere (project + sequence open): File > Scripts > browse to premiere_insert.jsx. It imports the clips and appends them to the active sequence's V1.",
      });
    } catch (e) {
      return fail(`build_premiere_script error: ${e.message}`);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
