// Generates a Premiere Pro ExtendScript (.jsx) that imports the given clips and
// appends them to the ACTIVE sequence's V1 track — Premiere's direct-to-timeline
// path (no signed panel needed). The user runs it via File > Scripts in Premiere.
import { basename } from "node:path";

function jsString(s) {
  // ExtendScript string literal — escape backslashes and quotes.
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function buildPremiereJsx(clips) {
  const list = (clips ?? [])
    .filter((c) => c && c.path)
    .map((c) => {
      const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(c.path);
      const dur = Number(c.duration) > 0 ? Number(c.duration) : isVideo ? 8 : 5;
      return `  { path: ${jsString(c.path)}, name: ${jsString(c.name || basename(c.path))}, dur: ${dur} }`;
    })
    .join(",\n");

  return `// B-Roll Studio — append clips to the active Premiere Pro sequence.
// Generated automatically. To run: open your project + sequence in Premiere,
// then File > Scripts (or any ExtendScript runner) and choose this file.
#target premierepro
(function () {
  var CLIPS = [
${list}
  ];

  if (!app.project) { alert("B-Roll Studio: open a project in Premiere first."); return; }
  var seq = app.project.activeSequence;
  if (!seq) { alert("B-Roll Studio: open a sequence (timeline) first."); return; }

  var paths = [];
  for (var i = 0; i < CLIPS.length; i++) paths.push(CLIPS[i].path);
  app.project.importFiles(paths, true, app.project.rootItem, false);

  // Find an imported project item by its media path (recursive through bins).
  function findByPath(item, target) {
    for (var i = 0; i < item.children.numItems; i++) {
      var ch = item.children[i];
      try { if (ch.getMediaPath && ch.getMediaPath() === target) return ch; } catch (e) {}
      if (ch.children && ch.children.numItems > 0) {
        var found = findByPath(ch, target);
        if (found) return found;
      }
    }
    return null;
  }

  var TICKS_PER_SECOND = 254016000000; // Premiere time base
  var insertSec = parseFloat(seq.end) / TICKS_PER_SECOND; // append at sequence end
  var track = seq.videoTracks[0];
  var added = 0;

  for (var j = 0; j < CLIPS.length; j++) {
    var pi = findByPath(app.project.rootItem, CLIPS[j].path);
    if (!pi) continue;
    try {
      track.overwriteClip(pi, insertSec);
      added++;
      insertSec += CLIPS[j].dur; // rough assembly; trim to taste
    } catch (e) {}
  }

  alert("B-Roll Studio: appended " + added + " of " + CLIPS.length + " clip(s) to \\"" + seq.name + "\\".");
})();
`;
}
