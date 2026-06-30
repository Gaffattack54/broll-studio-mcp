// Pure unit tests for the timeline builders (no network, no NLE needed).
import assert from "node:assert/strict";
import { buildFcpxml, buildEdl, buildManifest, normalizeClips } from "./timeline.mjs";

const clips = [
  { path: "C:/broll/nyc-skyline.jpg", name: "NYC skyline" }, // still → 5s
  { path: "C:/broll/traffic.mp4", duration: 6 }, // video → 6s
  { path: "C:/broll/coffee.png", duration: 3 }, // still → 3s
];

// normalizeClips infers type + duration
const norm = normalizeClips(clips);
assert.equal(norm.length, 3);
assert.equal(norm[0].type, "image");
assert.equal(norm[0].seconds, 5);
assert.equal(norm[1].type, "video");
assert.equal(norm[1].seconds, 6);
assert.equal(norm[2].seconds, 3);

// manifest: totals + offsets accumulate
const manifest = JSON.parse(buildManifest(clips, { title: "Test" }));
assert.equal(manifest.clip_count, 3);
assert.equal(manifest.total_seconds, 14);
assert.equal(manifest.clips[0].offset_seconds, 0);
assert.equal(manifest.clips[1].offset_seconds, 5);
assert.equal(manifest.clips[2].offset_seconds, 11);

// EDL: one event per clip, has header
const edl = buildEdl(clips, { title: "Test" });
assert.match(edl, /TITLE: Test/);
assert.match(edl, /FCM: NON-DROP FRAME/);
assert.equal((edl.match(/FROM CLIP NAME/g) || []).length, 3);
assert.match(edl, /001 {2}AX {7}V {5}C/); // first event line
// record-out of last event = 14s @30fps = 00:00:14:00
assert.match(edl, /00:00:14:00/);

// FCPXML: 3 assets, 3 spine clips, accumulating offsets, file URLs
const xml = buildFcpxml(clips, { title: "Test & Co" });
assert.equal((xml.match(/<asset /g) || []).length, 3);
assert.equal((xml.match(/<asset-clip /g) || []).length, 3);
assert.match(xml, /<fcpxml version="1.10">/);
assert.match(xml, /offset="0\/30s"/);
assert.match(xml, /offset="150\/30s"/); // second clip starts at 5s = 150f
assert.match(xml, /offset="330\/30s"/); // third starts at 11s = 330f
assert.match(xml, /duration="420\/30s"/); // sequence total 14s = 420f
assert.match(xml, /src="file:\/\/\/C:\/broll\/nyc-skyline\.jpg"/);
assert.match(xml, /Test &amp; Co/); // title escaped

console.log("TIMELINE-TESTS-OK");
