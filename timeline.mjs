// Universal timeline builders. From a flat list of downloaded clips we emit:
//   • FCPXML  — imports into Final Cut Pro, DaVinci Resolve, and Premiere Pro
//   • EDL (CMX 3600) — universal fallback, relinks by clip name
//   • manifest.json — unambiguous machine-readable description
// All clips are laid end-to-end on a single video track (a rough assembly the
// editor then trims). Time math is at a fixed 30fps.
import { basename } from "node:path";

const FPS = 30;
const DEFAULT_STILL_SECONDS = 5;

function frames(seconds) {
  return Math.max(1, Math.round(seconds * FPS));
}

// HH:MM:SS:FF at 30fps for an absolute frame count.
function tc(totalFrames) {
  const f = totalFrames % FPS;
  const totalSec = Math.floor(totalFrames / FPS);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

function fileUrl(absPath) {
  // file:// URL with forward slashes. encodeURI preserves the drive colon and
  // path separators (so "C:/a/b.jpg" stays "C:/a/b.jpg") while escaping spaces
  // and other characters NLEs choke on. Leading "/" for absolute POSIX paths.
  const norm = absPath.replace(/\\/g, "/");
  const enc = encodeURI(norm);
  return "file://" + (norm.startsWith("/") ? enc : "/" + enc);
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Normalize input clips → { name, path, type, seconds }.
export function normalizeClips(clips) {
  return (clips ?? [])
    .filter((c) => c && c.path)
    .map((c, i) => {
      const isVideo =
        c.type === "video" ||
        c.type === "stock_video" ||
        /\.(mp4|mov|m4v|webm)$/i.test(c.path);
      const seconds =
        Number(c.duration) > 0
          ? Number(c.duration)
          : isVideo
            ? 8
            : DEFAULT_STILL_SECONDS;
      return {
        name: c.name || basename(c.path) || `clip${i + 1}`,
        path: c.path,
        type: isVideo ? "video" : "image",
        seconds,
      };
    });
}

export function buildManifest(clips, { title = "B-Roll Studio Timeline" } = {}) {
  const norm = normalizeClips(clips);
  let offset = 0;
  const items = norm.map((c, i) => {
    const row = {
      index: i + 1,
      name: c.name,
      path: c.path,
      type: c.type,
      duration_seconds: c.seconds,
      offset_seconds: offset,
    };
    offset += c.seconds;
    return row;
  });
  return JSON.stringify(
    { title, fps: FPS, total_seconds: offset, clip_count: items.length, clips: items },
    null,
    2,
  );
}

export function buildEdl(clips, { title = "B-Roll Studio Timeline" } = {}) {
  const norm = normalizeClips(clips);
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  let rec = 0;
  norm.forEach((c, i) => {
    const dur = frames(c.seconds);
    const ev = String(i + 1).padStart(3, "0");
    lines.push(
      `${ev}  AX       V     C        ${tc(0)} ${tc(dur)} ${tc(rec)} ${tc(rec + dur)}`,
    );
    lines.push(`* FROM CLIP NAME: ${c.name}`);
    lines.push("");
    rec += dur;
  });
  return lines.join("\n");
}

export function buildFcpxml(clips, { title = "B-Roll Studio Timeline" } = {}) {
  const norm = normalizeClips(clips);
  const totalFrames = norm.reduce((n, c) => n + frames(c.seconds), 0);

  const resources = [
    `    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>`,
  ];
  const spine = [];
  let offset = 0;
  norm.forEach((c, i) => {
    const id = `a${i + 1}`;
    const dur = `${frames(c.seconds)}/30s`;
    const off = `${offset}/30s`;
    const hasVideo = "1";
    // Stills have no intrinsic duration → give the asset a long one.
    const assetDur = c.type === "video" ? dur : "360000/30s";
    resources.push(
      `    <asset id="${id}" name="${xmlEscape(c.name)}" start="0s" duration="${assetDur}" hasVideo="${hasVideo}" videoSources="1" format="r1">` +
        `<media-rep kind="original-media" src="${fileUrl(c.path)}"/></asset>`,
    );
    spine.push(
      `        <asset-clip ref="${id}" name="${xmlEscape(c.name)}" offset="${off}" duration="${dur}" start="0s" format="r1"/>`,
    );
    offset += frames(c.seconds);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${resources.join("\n")}
  </resources>
  <library>
    <event name="B-Roll Studio">
      <project name="${xmlEscape(title)}">
        <sequence format="r1" tcStart="0s" tcFormat="NDF" duration="${totalFrames}/30s">
          <spine>
${spine.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
