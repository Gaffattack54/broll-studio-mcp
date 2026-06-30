#!/usr/bin/env python
"""Insert downloaded clips directly onto the OPEN DaVinci Resolve timeline.

Called by the MCP `place_in_resolve` tool. Imports the given media into the
current project's media pool and appends them to the current timeline (creating
one if none is open). Prints a single JSON line of the result.

Requires DaVinci Resolve to be running, with:
  Preferences > System > General > "External scripting using" = Local (or Network).
"""
import sys
import os
import json


def load_bmd():
    """Load Blackmagic's scripting module, injecting default paths if needed."""
    try:
        import DaVinciResolveScript as bmd  # PYTHONPATH already set up
        return bmd
    except ImportError:
        if sys.platform.startswith("darwin"):
            api = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
            lib = "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
        elif sys.platform.startswith("win"):
            pdata = os.environ.get("PROGRAMDATA", r"C:\ProgramData")
            api = os.path.join(pdata, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Scripting")
            pfiles = os.environ.get("PROGRAMFILES", r"C:\Program Files")
            lib = os.path.join(pfiles, "Blackmagic Design", "DaVinci Resolve", "fusionscript.dll")
        else:
            api = "/opt/resolve/Developer/Scripting"
            lib = "/opt/resolve/libs/Fusion/fusionscript.so"
        api = os.environ.get("RESOLVE_SCRIPT_API", api)
        lib = os.environ.get("RESOLVE_SCRIPT_LIB", lib)
        os.environ["RESOLVE_SCRIPT_API"] = api
        os.environ["RESOLVE_SCRIPT_LIB"] = lib
        sys.path.append(os.path.join(api, "Modules"))
        import DaVinciResolveScript as bmd
        return bmd


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    args = sys.argv[1:]
    if len(args) == 1 and args[0].lstrip().startswith("["):
        paths = json.loads(args[0])
    else:
        paths = args
    paths = [p for p in paths if p]
    if not paths:
        return emit({"ok": False, "error": "no_paths"})

    try:
        bmd = load_bmd()
    except Exception as e:  # module missing / wrong Resolve install
        return emit({"ok": False, "error": "resolve_module_not_found", "detail": str(e)})

    resolve = bmd.scriptapp("Resolve")
    if not resolve:
        return emit({
            "ok": False,
            "error": "resolve_not_running",
            "detail": "Open DaVinci Resolve and set Preferences > System > General > External scripting using = Local.",
        })

    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        return emit({"ok": False, "error": "no_project", "detail": "Open or create a project in Resolve."})

    media_pool = project.GetMediaPool()
    items = media_pool.ImportMedia(paths)
    if not items:
        return emit({"ok": False, "error": "import_failed", "detail": "Resolve imported no media from those paths."})

    timeline = project.GetCurrentTimeline()
    created = False
    if not timeline:
        timeline = media_pool.CreateEmptyTimeline("B-Roll Studio")
        created = True

    appended = media_pool.AppendToTimeline(items)
    count = len(appended) if isinstance(appended, list) else (len(items) if appended else 0)
    emit({
        "ok": True,
        "imported": len(items),
        "appended": count,
        "timeline": timeline.GetName() if timeline else None,
        "created_timeline": created,
    })


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # last-resort: always emit JSON
        emit({"ok": False, "error": "unexpected", "detail": str(e)})
