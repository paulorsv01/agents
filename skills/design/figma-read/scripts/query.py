#!/usr/bin/env python3
"""query.py — read a decoded .fig cache. Standard library only.

  query.py spec    <node|url> ...   [--symbols all|direct|none] [--max-lines N] [--dir D]
  query.py info                     [--dir D]
  query.py inspect <node|url> ...   [--dir D]
  query.py tree    <node|url> ...   [--depth N] [--limit N]
  query.py texts   <node|url> ...   [--limit N]
  query.py find    <pattern>        [--type T] [--limit N]
  query.py raw     <node|url> ...   [--fields a,b,c]

<node> is 8099:18638, 8099-18638, or a full Figma URL containing node-id=.
Node-taking commands accept several nodes per invocation. Reads the cache
written by decode.mjs; seeks one line out of nodes.jsonl rather than parsing
the whole document. If the cache was purged from $TMPDIR but the .fig still
exists, it re-decodes automatically (disable with --no-decode).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import time
import sys
import hashlib
import tempfile
from pathlib import Path

REGISTRY = Path(os.environ.get("FIGMA_READ_REGISTRY", Path.home() / ".cache" / "figma-read" / "registry.json"))
CONFIG = Path(os.environ.get("FIGMA_READ_CONFIG", Path.home() / ".cache" / "figma-read" / "config.json"))

# What to do when a Figma URL arrives and no .fig has been decoded for it.
WHEN_NO_FIG = {
    "ask": "ask the user each time whether to export a .fig or use another tool",
    "always": "always use this skill — ask the user to export a .fig",
    "mcp": "prefer the Figma MCP when no .fig exists; do not ask for an export",
}


# --------------------------------------------------------------------------- cache

# Toggled off by --no-decode / FIGMA_READ_NO_AUTODECODE. When on, a query whose
# cache was purged from $TMPDIR re-runs decode.mjs itself instead of telling the
# agent to — the registry still knows the .fig path, and a re-decode is a
# no-op-fast operation (~1s), far cheaper than the 3-4 probing calls the old
# dead-end message caused.
AUTODECODE = not os.environ.get("FIGMA_READ_NO_AUTODECODE")


def registry_rows():
    """Every registry entry, live or not. Dead rows keep the figPath that
    recovery needs — dropping them here is what used to make a purged cache
    unrecoverable without asking the user."""
    if not REGISTRY.exists():
        return []
    try:
        reg = json.loads(REGISTRY.read_text())
    except Exception:
        return []
    return [e for e in reg if isinstance(e, dict) and e.get("dir")]


def is_live(e):
    return (Path(e.get("dir", "")) / "index.json").exists()


def known_caches():
    """Registry entries whose cache still exists on disk.

    Caches live under $TMPDIR and are purged when idle; this registry only
    records where each one is, so dead rows are expected and dropped here.
    """
    return [e for e in registry_rows() if is_live(e)]


def decode_cmd(entry):
    """The exact decode command for a registry row — real paths, no placeholders."""
    mjs = Path(__file__).resolve().parent / "decode.mjs"
    cmd = f'node "{mjs}" "{entry.get("figPath")}"'
    if entry.get("urlFileKey"):
        cmd += f' --url "https://www.figma.com/design/{entry["urlFileKey"]}"'
    return cmd


def ensure_cache(entry):
    """Re-decode a purged cache from its .fig, if everything needed is at hand.

    Returns the cache dir on success, None when recovery is impossible (fig
    moved, node missing, autodecode disabled) — callers fall through to an
    error message that includes the exact command instead.
    """
    fig = entry.get("figPath")
    if not (AUTODECODE and fig and Path(fig).exists() and shutil.which("node")):
        return None
    mjs = Path(__file__).resolve().parent / "decode.mjs"
    if not mjs.exists():
        return None
    args = ["node", str(mjs), fig]
    if entry.get("urlFileKey"):
        args += ["--url", f"https://www.figma.com/design/{entry['urlFileKey']}"]
    print(f"cache was purged from $TMPDIR — re-decoding {fig} (one time, ~seconds)…", file=sys.stderr)
    try:
        out = subprocess.run(args, capture_output=True, text=True)
    except OSError as e:
        print(f"auto-decode failed to start: {e}", file=sys.stderr)
        return None
    if out.returncode != 0:
        print(f"auto-decode failed:\n{out.stderr.strip() or out.stdout.strip()}", file=sys.stderr)
        return None
    # decode.mjs prints the cache dir as its last stdout line
    lines = [l for l in out.stdout.strip().splitlines() if l.strip()]
    cand = Path(lines[-1]) if lines else Path(entry["dir"])
    return cand if (cand / "index.json").exists() else None


def no_cache_message(rows):
    """Actionable text for 'nothing decoded': name what the registry knows."""
    if not rows:
        return "No decoded .fig found. Run: " + str(Path(__file__).resolve().parent / "decode.mjs") + " <file.fig> --url <figma-url>  (with node)"
    lines = ["No live cache. The registry records these decodes:"]
    for e in rows:
        fig = e.get("figPath")
        status = "" if fig and Path(fig).exists() else "  (fig file missing — re-export from Figma?)"
        lines.append(f"  {fig}{status}")
        lines.append(f"    recover with: {decode_cmd(e)}")
    return "\n".join(lines)


def fig_mtime(entry):
    try:
        return Path(entry["figPath"]).stat().st_mtime
    except (OSError, KeyError, TypeError):
        return 0.0


def pick_by_file_key(tied, key):
    """Choose between caches of the same document, out loud.

    The cache name is derived from the .fig path, not from the document, so
    re-exporting to a new path (Downloads first, then the project) gives one
    design two caches with the same file key. Registry order used to decide it
    silently, which meant the oldest decode won. A URL names the document
    unambiguously and both caches are that document, so this picks the newest
    export and says so instead of failing.
    """
    if len(tied) == 1:
        return tied[0]
    chosen = max(tied, key=fig_mtime)
    others = " ".join(f'--dir "{e["dir"]}"' for e in tied if e is not chosen)
    print(f"{len(tied)} caches share file key {key}; using {chosen['dir']} "
          f"({chosen.get('figPath')}, newest .fig). Force another with: {others}", file=sys.stderr)
    return chosen


def resolve_dir(explicit, ref=None):
    if explicit:
        return Path(explicit).expanduser()
    if os.environ.get("FIGMA_READ_DIR"):
        return Path(os.environ["FIGMA_READ_DIR"]).expanduser()

    entries = known_caches()
    # a Figma URL names its file key; prefer a cache tagged with that key at decode time
    if ref:
        m = re.search(r"/(?:design|file)/([A-Za-z0-9]{10,})", ref)
        if m:
            tied = [e for e in entries if e.get("urlFileKey") == m.group(1)]
            if tied:
                return Path(pick_by_file_key(tied, m.group(1))["dir"])
    # Otherwise prefer the design whose .fig sits under the current directory.
    # The cache itself now lives in $TMPDIR, so matching on its path would never
    # hit; figPath is what still ties a design to the project you are standing in.
    # is_relative_to, not startswith: a string prefix test makes cwd /a/app match
    # a sibling /a/app-old.
    cwd = Path.cwd().resolve()
    def under_cwd(e):
        for key in ("figPath", "dir"):
            v = e.get(key)
            if v:
                try:
                    if Path(v).resolve().is_relative_to(cwd):
                        return True
                except OSError:
                    pass
        return False
    local = [e for e in entries if under_cwd(e)]
    if len(local) == 1:
        return Path(local[0]["dir"])
    if len(entries) == 1:
        return Path(entries[0]["dir"])
    if not entries:
        # Nothing live — but a dead registry row still knows where the .fig is,
        # so recover in-place rather than dead-ending the query.
        dead = [e for e in registry_rows() if not is_live(e)]
        pick = None
        if ref:
            m = re.search(r"/(?:design|file)/([A-Za-z0-9]{10,})", ref)
            if m:
                tied = [e for e in dead if e.get("urlFileKey") == m.group(1)]
                pick = pick_by_file_key(tied, m.group(1)) if tied else None
        if pick is None and len(dead) == 1:
            pick = dead[0]
        if pick:
            recovered = ensure_cache(pick)
            if recovered:
                return recovered
        sys.exit(no_cache_message(dead))
    sys.exit(
        "Multiple decoded designs — pass --dir with one of:\n  "
        + "\n  ".join(f"{e['dir']}   ({e.get('fig')})" for e in entries)
    )


class Cache:
    def __init__(self, path):
        self.dir = path
        # $TMPDIR is purged per *file*, and index.json/lookup.json get an atime
        # bump from every query while nodes.jsonl is only touched by inspect/raw/
        # texts — so a cache driven through list/info/find alone can lose just
        # nodes.jsonl and still look healthy. Check all three, and refresh their
        # atimes together so the purge cannot split them apart.
        parts = ("index.json", "lookup.json", "nodes.jsonl")
        missing = [f for f in parts if not (path / f).exists()]
        if missing:
            # Try in-place recovery first: the registry row for this dir still
            # holds the .fig path, and decode.mjs is idempotent.
            row = next((e for e in registry_rows() if e.get("dir") == str(path)), None)
            if row and len(missing) < len(parts):
                # half-purged: force a full rebuild, the mtime gate would skip it
                fig = row.get("figPath")
                if AUTODECODE and fig and Path(fig).exists() and shutil.which("node"):
                    mjs = Path(__file__).resolve().parent / "decode.mjs"
                    print(f"cache at {path} is incomplete (missing {', '.join(missing)}) — rebuilding from {fig}…", file=sys.stderr)
                    subprocess.run(["node", str(mjs), fig, "--force"], capture_output=True, text=True)
                    missing = [f for f in parts if not (path / f).exists()]
            elif row:
                rec = ensure_cache(row)
                if rec:
                    path = self.dir = rec
                    missing = [f for f in parts if not (path / f).exists()]
        if len(missing) == len(parts):
            # Nothing there at all — a wrong or stale path, not a half-purged
            # cache. Saying "purged" would send someone off on a needless decode.
            sys.exit(
                f"no cache at {path}\n"
                "Check the path, or list what is decoded with:  query.py list"
            )
        if missing:
            row = next((e for e in registry_rows() if e.get("dir") == str(path)), None)
            hint = decode_cmd(row) + " --force" if row and row.get("figPath") else \
                "node <skill>/scripts/decode.mjs <file.fig> --force"
            sys.exit(
                f"cache at {path} is incomplete (missing {', '.join(missing)}).\n"
                "It was probably partly purged from $TMPDIR. Re-run:\n"
                f"  {hint}"
            )
        now = time.time()
        for f in ("index.json", "lookup.json", "nodes.jsonl"):
            try:
                os.utime(path / f, (now, (path / f).stat().st_mtime))
            except OSError:
                pass
        idx = json.loads((path / "index.json").read_text())
        self.source = idx["source"]
        self.nodes = idx["nodes"]          # id -> [name, type, parent, offset, length]
        lk = json.loads((path / "lookup.json").read_text())
        # .get throughout: a cache written by an older decode.mjs is missing keys,
        # and a KeyError here would be a baffling way to learn that.
        self.prop_defs = lk.get("propDefs", {})
        self.prop_def_parent = lk.get("propDefParent", {})
        self.vars_by_guid = lk.get("variablesByGuid", {})
        self.vars_by_key = lk.get("variablesByKey", {})
        self.symbols = lk.get("symbols", {})
        self.vars_by_name = {v["name"]: v for v in self.vars_by_key.values() if v.get("name")}
        self._children = None
        self._fh = None

    def raw(self, nid):
        """Seek a single node's full JSON out of nodes.jsonl."""
        rec = self.nodes.get(nid)
        if not rec:
            return None
        if self._fh is None:
            self._fh = open(self.dir / "nodes.jsonl", "rb")
        self._fh.seek(rec[3])
        return json.loads(self._fh.read(rec[4]).decode())

    def prop_name(self, defid):
        """Instances reference a variant-level def id; the name sits on its parent."""
        cur, seen = defid, set()
        while cur and cur not in seen:
            seen.add(cur)
            if cur in self.prop_defs:
                return self.prop_defs[cur]
            cur = self.prop_def_parent.get(cur)
        return None

    def name(self, nid):
        r = self.nodes.get(nid)
        return r[0] if r else None

    def type(self, nid):
        r = self.nodes.get(nid)
        return r[1] if r else None

    def parent(self, nid):
        r = self.nodes.get(nid)
        return r[2] if r else None

    def children(self, nid):
        if self._children is None:
            self._children = {}
            for i, r in self.nodes.items():
                self._children.setdefault(r[2], []).append(i)
        return self._children.get(nid, [])

    def ancestry(self, nid):
        chain, cur, seen = [], nid, set()
        while cur and cur in self.nodes and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            cur = self.parent(cur)
        return chain


# --------------------------------------------------------------------------- helpers

def norm_id(s):
    m = re.search(r"node-id=(\d+)[-:](\d+)", s)
    if m:
        return f"{m.group(1)}:{m.group(2)}"
    m = re.fullmatch(r"(\d+)[-:](\d+)", s.strip())
    if m:
        return f"{m.group(1)}:{m.group(2)}"
    return s.strip()


def hexcolor(c):
    if not isinstance(c, dict):
        return None
    to = lambda v: max(0, min(255, round(float(v) * 255)))
    return "#%02X%02X%02X" % (to(c.get("r", 0)), to(c.get("g", 0)), to(c.get("b", 0)))


def alias_key(v):
    """Pull the library variable key out of an alias-shaped value."""
    if isinstance(v, dict):
        ar = v.get("alias", {}).get("assetRef") if "alias" in v else None
        if isinstance(ar, dict):
            return ar.get("key")
    return None


def token_name(cache, key):
    rec = cache.vars_by_key.get(key)
    return rec["name"] if rec else None


# Every shape a text-valued property is known to take. `textValue` really occurs:
# componentPropDefs carry initialValue as {"textValue": {"characters": ...}}.
TEXT_SHAPES = ("textDataValue", "textValue", "stringValue")


def text_value(val):
    """The string a property holds, if it holds text at all — else None.

    Single source of truth for both `scalar` (which renders it) and `texts`
    (which harvests copy). Kept in one place on purpose: when the two sites had
    separate ideas of what counted as text, a property in a shape only one of
    them knew about showed up in `inspect` and vanished from `texts` — silent
    copy loss, the exact failure this is meant to prevent.
    """
    if not isinstance(val, dict):
        return None
    inner = val.get("value", val)
    if not isinstance(inner, dict):
        return None
    for k in TEXT_SHAPES:
        if k in inner:
            v = inner[k]
            if isinstance(v, dict):
                v = v.get("characters")
            return v if isinstance(v, str) else None
    return None


def scalar(cache, val):
    """Render a component-property / variable value compactly."""
    if not isinstance(val, dict):
        return val
    text = text_value(val)
    if text is not None:
        return text
    for k in ("boolValue", "floatValue", "numberValue"):
        if k in val:
            return val[k]
    k = alias_key(val)
    if k:
        return f"<token {token_name(cache, k) or k}>"
    if "value" in val:
        return scalar(cache, val["value"])
    return None


# ----------------------------------------------------------------- spec helpers
# Shared by `spec` (one line per node) and `inspect` (labelled sections), so the
# two views cannot drift apart on what a paint/effect/font looks like.

def fmt_num(v):
    if isinstance(v, float):
        s = f"{v:.2f}".rstrip("0").rstrip(".")
        return s or "0"
    return str(v)


def fmt_color(c):
    hx = hexcolor(c)
    if not hx:
        return None
    a = c.get("a", 1) if isinstance(c, dict) else 1
    return hx if a in (None, 1) else f"{hx}/{fmt_num(a)}"


def fmt_paint(cache, p):
    """One paint → compact string: SOLID hex(+token), gradient with stops, image."""
    if not isinstance(p, dict) or p.get("visible") is False:
        return None
    t = p.get("type", "")
    if t == "SOLID" or p.get("color"):
        s = fmt_color(p.get("color")) or t.lower()
        op = p.get("opacity", 1)
        if op is not None and op != 1:
            s += f"/{fmt_num(op)}"
        tok = token_name(cache, alias_key(p.get("colorVar", {}).get("value", {}))) if p.get("colorVar") else None
        if tok:
            s += f" [{tok}]"
        return s
    if t.startswith("GRADIENT"):
        stops = ", ".join(
            f"{fmt_color(st.get('color'))}@{fmt_num(st.get('position', 0))}"
            for st in p.get("stops", []) if fmt_color(st.get("color"))
        )
        return f"{t.lower()}({stops})"
    if t == "IMAGE":
        w, h = p.get("originalImageWidth"), p.get("originalImageHeight")
        bits = [f"{w}x{h}" if w else None, (p.get("imageScaleMode") or "").lower() or None]
        if p.get("scale") not in (None, 1):
            bits.append(f"scale={fmt_num(p['scale'])}")
        return f"image({' '.join(b for b in bits if b)})"
    return t.lower() or None


def fmt_effect(e):
    """Any effect type → type(x,y,radius,#hex/a). Real exports carry more than
    DROP_SHADOW (e.g. FOREGROUND_BLUR), so this stays type-agnostic."""
    if not isinstance(e, dict) or e.get("visible") is False:
        return None
    off = e.get("offset") or {}
    bits = [fmt_num(off.get("x", 0)), fmt_num(off.get("y", 0)), fmt_num(e.get("radius", 0))]
    c = fmt_color(e.get("color"))
    if c:
        bits.append(c)
    return f"{(e.get('type') or 'effect').lower()}({','.join(bits)})"


def node_size(n):
    v = (n.get("size") or {}).get("value", n.get("size")) or {}
    if v.get("x") is None:
        return None
    return f"{fmt_num(v['x'])}x{fmt_num(v['y'])}"


def bound_token_map(cache, n):
    """{variableField: token_name} for every bound design token on the node."""
    out = {}
    for e in (n.get("variableConsumptionMap") or {}).get("entries") or []:
        k = alias_key(e.get("variableData", {}).get("value", {}))
        if k and e.get("variableField"):
            out[e["variableField"]] = token_name(cache, k) or k
    return out


def corner_radius(n):
    # A uniform radius arrives as plain `cornerRadius`; per-corner values as
    # four rectangle*CornerRadius fields. Real files use both.
    radii = [n[k] for k in n if k.startswith("rectangle") and k.endswith("CornerRadius") and n.get(k)]
    if not radii and n.get("cornerRadius"):
        radii = [n["cornerRadius"]]
    return list(dict.fromkeys(radii)) or None


def layout_compact(n, toks):
    """Auto-layout in one breath: `row gap=24 [tok] pad=0,0,32,0 r=16`."""
    bits = []
    if n.get("stackMode"):
        bits.append("row" if n["stackMode"] == "HORIZONTAL" else "col")
    if n.get("stackSpacing") is not None:
        g = f"gap={fmt_num(n['stackSpacing'])}"
        if toks.get("STACK_SPACING"):
            g += f" [{toks['STACK_SPACING']}]"
        bits.append(g)
    pad = [n.get("stackVerticalPadding"), n.get("stackPaddingRight"),
           n.get("stackPaddingBottom"), n.get("stackHorizontalPadding")]
    if any(v is not None for v in pad):
        p = "pad=" + ",".join(fmt_num(v or 0) for v in pad)
        ptoks = dict.fromkeys(t for f, t in toks.items() if f.startswith("STACK_PADDING"))
        if ptoks:
            p += " [" + ", ".join(ptoks) + "]"
        bits.append(p)
    rad = corner_radius(n)
    if rad:
        r = "r=" + "/".join(fmt_num(v) for v in rad)
        rtok = dict.fromkeys(t for f, t in toks.items() if f.endswith("CORNER_RADIUS"))
        if rtok:
            r += " [" + ", ".join(rtok) + "]"
        bits.append(r)
    return bits


def text_compact(n, limit=110):
    """TEXT node → `"chars" Family Style 14px lh=1.57`. None for non-text."""
    td = (n.get("textData") or {}).get("characters")
    if td is None:
        return None
    chars = td if len(td) <= limit else td[:limit] + "…"
    bits = [json.dumps(chars, ensure_ascii=False)]
    f = n.get("fontName") or {}
    fam = " ".join(x for x in (f.get("family"), f.get("style")) if x)
    if fam:
        bits.append(fam)
    if n.get("fontSize") is not None:
        bits.append(f"{fmt_num(n['fontSize'])}px")
    lh = n.get("lineHeight") or {}
    if isinstance(lh, dict) and lh.get("value") is not None:
        u = {"PIXELS": "px", "PERCENT": "%"}.get(lh.get("units"), "")
        bits.append(f"lh={fmt_num(lh['value'])}{u}")
    ls = n.get("letterSpacing") or {}
    if isinstance(ls, dict) and ls.get("value"):
        u = {"PIXELS": "px", "PERCENT": "%"}.get(ls.get("units"), "")
        bits.append(f"ls={fmt_num(ls['value'])}{u}")
    return " ".join(bits)


def sym_id_of(n):
    sym = (n.get("symbolData") or {}).get("symbolID")
    if not sym:
        return None
    return f"{sym.get('sessionID', 0)}:{sym.get('localID', 0)}"


def sym_label(cache, sid):
    """Component label, prefixed with the component-set name when there is one
    (a SYMBOL's parent FRAME carries it: `Searchbar_XS: type=standart, …`)."""
    base = cache.symbols.get(sid) or cache.name(sid) or sid
    pid = cache.parent(sid)
    if pid and cache.type(pid) == "FRAME" and cache.name(pid) and "=" in (base or ""):
        return f"{cache.name(pid)}: {base}"
    return base


def guid_id(g):
    if isinstance(g, dict) and isinstance(g.get("sessionID"), int) and isinstance(g.get("localID"), int):
        return f"{g['sessionID']}:{g['localID']}"
    return None


def assignment_symbol(assignment):
    value = assignment.get("varValue") or {}
    if "SYMBOL_ID" not in (value.get("dataType"), value.get("resolvedDataType")):
        return None
    return guid_id((value.get("value", {}).get("symbolIdValue") or {}).get("guid"))


def symbol_choices(n):
    """Read explicit symbol references without claiming their replacement targets are resolved."""
    choices = []
    sources = [(n, [])] + [(ov, [guid_id(g) or "?" for g in (ov.get("guidPath") or {}).get("guids", [])])
                          for ov in (n.get("symbolData") or {}).get("symbolOverrides") or []]
    for source, path in sources:
        if source is not n and sym_id_of(source):
            choices.append((sym_id_of(source), "symbolData.symbolID", path))
        for assignment in source.get("componentPropAssignments") or []:
            sid = assignment_symbol(assignment)
            if sid:
                choices.append((sid, guid_id(assignment.get("defID")) or "?", path))
    return choices


def symbol_choice_lines(cache, n):
    out = []
    for sid, prop, path in symbol_choices(n):
        label = cache.prop_name(prop) or (prop if prop == "symbolData.symbolID" else f"<def {prop}>")
        availability = "" if sid in cache.nodes else " (symbol absent from cache; origin unknown)"
        out.append(f"symbol choice: {label} → «{sym_label(cache, sid)}» ({sid}) "
                   f"guidPath={'/'.join(path) or '(instance)'}{availability}")
    return out


def referenced_symbols(n):
    return list(dict.fromkeys(sid for sid in [sym_id_of(n)] + [c[0] for c in symbol_choices(n)] if sid))


def prop_lines(cache, n):
    """Component property assignments as `name=value` strings."""
    out = []
    for as_ in n.get("componentPropAssignments") or []:
        did = as_.get("defID", {})
        key = f"{did.get('sessionID', 0)}:{did.get('localID', 0)}"
        label = cache.prop_name(key) or f"<def {key}>"
        sid = assignment_symbol(as_)
        if sid:
            continue
        val = scalar(cache, as_.get("varValue") or as_.get("value") or {})
        if isinstance(val, str):
            val = json.dumps(val, ensure_ascii=False)
        out.append(f"{label}={val}")
    return out


# Override keys that are geometry/bookkeeping noise, never worth a line.
OVERRIDE_NOISE = ("size", "overrideLevel", "guidPath", "transform",
                  "interactionsRemoved", "overriddenSymbolID")


def override_lines(cache, n, cap=6):
    """Instance overrides worth reading: copy, visibility, fills, prop values.

    Per-row copy lives here — 50 of the 870 overrides in a real section carry
    textData, and none of it is reachable through child TEXT nodes.
    """
    out = []
    ovs = (n.get("symbolData") or {}).get("symbolOverrides") or []
    hidden = 0
    for ov in ovs:
        guids = (ov.get("guidPath") or {}).get("guids") or []
        leaf = f"{guids[-1].get('sessionID', 0)}:{guids[-1].get('localID', 0)}" if guids else None
        where = cache.name(leaf) or leaf or "?"
        td = (ov.get("textData") or {}).get("characters")
        if td is not None:
            out.append(f"{where}: {json.dumps(td, ensure_ascii=False)}")
        if ov.get("visible") is False:
            hidden += 1
        for as_ in ov.get("componentPropAssignments") or []:
            if assignment_symbol(as_):
                continue
            v = scalar(cache, as_.get("varValue") or as_.get("value") or {})
            if v is not None:
                did = as_.get("defID", {})
                key = f"{did.get('sessionID', 0)}:{did.get('localID', 0)}"
                out.append(f"{cache.prop_name(key) or f'<def {key}>'}={json.dumps(v, ensure_ascii=False)}")
        paints = [fmt_paint(cache, p) for p in ov.get("fillPaints") or []]
        paints = [p for p in paints if p]
        if paints:
            out.append(f"{where}: fill={','.join(paints)}")
    if hidden:
        out.append(f"hidden inside: {hidden} node(s)")
    if cap is not None and len(out) > cap:
        out = out[:cap] + [f"… +{len(out) - cap} more overrides (inspect {{id}}; raw {{id}} --fields symbolData)"]
    return out + symbol_choice_lines(cache, n)


def spec_line(cache, nid, n):
    """One implementation-ready line for a node (no indent, no children)."""
    bits = [f"[{n.get('type')}] {n.get('name')} ({nid})"]
    sz = node_size(n)
    if sz:
        bits.append(sz)
    toks = bound_token_map(cache, n)
    bits += layout_compact(n, toks)
    fills = [fmt_paint(cache, p) for p in n.get("fillPaints") or []]
    fills = [f for f in fills if f]
    if fills:
        bits.append("fill=" + ",".join(fills))
    strokes = [fmt_paint(cache, p) for p in n.get("strokePaints") or []]
    strokes = [s for s in strokes if s]
    if strokes:
        st = "stroke=" + ",".join(strokes)
        if n.get("strokeWeight") not in (None, 1):
            st += f" w={fmt_num(n['strokeWeight'])}"
        if n.get("strokeAlign"):
            st += f" {n['strokeAlign'].lower()}"
        bits.append(st)
    effs = [fmt_effect(e) for e in n.get("effects") or []]
    effs = [e for e in effs if e]
    bits += effs
    if n.get("opacity") not in (None, 1):
        bits.append(f"opacity={fmt_num(n['opacity'])}")
    txt = text_compact(n)
    if txt:
        bits.append(txt)
    # tokens bound to fields not already shown inline
    handled = ("STACK_SPACING", "STACK_PADDING", "CORNER_RADIUS")
    extra = dict.fromkeys(t for f, t in toks.items() if not f.startswith(handled[1]) and f != handled[0] and not f.endswith(handled[2]))
    if extra:
        bits.append("tokens: " + ", ".join(extra))
    sid = sym_id_of(n)
    if sid:
        bits.append(f"→ «{sym_label(cache, sid)}» ({sid})")
    return " ".join(bits)


# --------------------------------------------------------------------------- views

def read_config():
    if CONFIG.exists():
        try:
            return json.loads(CONFIG.read_text())
        except Exception:
            pass
    return {}


def cmd_config(_cache, a):
    cfg = read_config()
    if a.set_when_no_fig:
        if a.set_when_no_fig not in WHEN_NO_FIG:
            sys.exit(f"unknown value — pick one of: {', '.join(WHEN_NO_FIG)}")
        cfg["whenNoFig"] = a.set_when_no_fig
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps(cfg, indent=2) + "\n")
        print(f"saved: whenNoFig = {a.set_when_no_fig}")
        return
    current = cfg.get("whenNoFig")
    if current:
        print(f"whenNoFig = {current}   ({WHEN_NO_FIG.get(current, 'unknown value')})")
    else:
        print("whenNoFig = (unset — ask the user once, then record their answer)")
    print(f"\nfile: {CONFIG}")
    print("options:")
    for k, v in WHEN_NO_FIG.items():
        print(f"  {k:<8} {v}")
    print("\nset with: query.py config --set-when-no-fig <option>")


def cmd_list(_cache, _a):
    rows = registry_rows()
    if not rows:
        mjs = Path(__file__).resolve().parent / "decode.mjs"
        print(f"no decoded designs yet — run: node {mjs} <file.fig> --url <figma-url>")
        return
    for e in rows:
        print(f"{e.get('figFileName') or e.get('fig')}")
        if is_live(e):
            print(f"  dir:      {e['dir']}")
        else:
            print(f"  dir:      {e['dir']}  (cache purged — the next query re-decodes from {e.get('figPath')})")
        print(f"  file key: {e.get('urlFileKey') or '(not tagged — pass --url when decoding)'}")


def cmd_info(cache, _a):
    s = cache.source
    print(f"fig:        {s.get('fig')}")
    print(f"figma name: {s.get('figFileName')}")
    print(f"exported:   {s.get('exportedAt')}")
    print(f"file key:   {s.get('originFileKey')}")
    print(f"nodes:      {len(cache.nodes)}")
    print(f"variables:  {len(cache.vars_by_key)}")
    print(f"cache:      {cache.dir}")
    kinds = {}
    for r in cache.nodes.values():
        kinds[r[1]] = kinds.get(r[1], 0) + 1
    top = sorted(kinds.items(), key=lambda x: -x[1])
    more = f"  … +{len(top) - 12} more types" if len(top) > 12 else ""
    print("types:      " + ", ".join(f"{k}={v}" for k, v in top[:12]) + more)


def not_found(cache, nid):
    return (f"node {nid} not found in {cache.dir}\n"
            f"Look it up by name:  query.py find '<part-of-name>'   "
            "(layer names typically use - or _ where the design shows spaces)")


def cmd_inspect(cache, a):
    for idx, node in enumerate(a.node):
        if idx:
            print(f"\n────── {norm_id(node)} ──────\n")
        inspect_one(cache, node)


def inspect_one(cache, node):
    nid = norm_id(node)
    n = cache.raw(nid)
    if n is None:
        sys.exit(not_found(cache, nid))

    print(f"Node: {n.get('name')} ({nid}) [{n.get('type')}]")
    if n.get("symbolDescription"):
        print(f"Description: {n['symbolDescription']}")

    sym = n.get("symbolData", {}).get("symbolID")
    if sym:
        sid = f"{sym.get('sessionID',0)}:{sym.get('localID',0)}"
        print(f"Component: {cache.symbols.get(sid) or cache.name(sid) or '?'}  (symbol {sid})")

    properties = prop_lines(cache, n)
    if properties:
        print("\nComponent properties:")
        for line in properties:
            print(f"  {line}")
    overrides = override_lines(cache, n, cap=None)
    if overrides:
        print("\nOverrides and symbol choices (references; use assets for target resolution):")
        for line in overrides:
            print(f"  {line}")

    # layout
    lay = []
    if n.get("stackMode"):
        lay.append(("Flow", "Horizontal" if n["stackMode"] == "HORIZONTAL" else n["stackMode"].title()))
    def xy(v):
        # some fields arrive wrapped as {"value": {"x":..,"y":..}}
        v = (v or {}).get("value", v) or {}
        return f"{v.get('x')}x{v.get('y')}" if v.get("x") is not None else None

    if xy(n.get("size")):
        lay.append(("Size", xy(n.get("size"))))
    if xy(n.get("minSize")):
        lay.append(("Min size", xy(n.get("minSize"))))
    for k, lbl in (("stackPrimarySizing", "Primary sizing"), ("stackCounterSizing", "Counter sizing"),
                   ("stackPrimaryAlignItems", "Primary align"), ("stackCounterAlignItems", "Counter align")):
        if n.get(k):
            lay.append((lbl, n[k]))
    # Figma does NOT store four symmetric padding fields. Left and top live in
    # stackHorizontalPadding / stackVerticalPadding; right and bottom have their
    # own keys. There is no stackPaddingLeft or stackPaddingTop. Anything absent
    # is the default, 0.
    pad = {
        "top": n.get("stackVerticalPadding"),
        "right": n.get("stackPaddingRight"),
        "bottom": n.get("stackPaddingBottom"),
        "left": n.get("stackHorizontalPadding"),
    }
    if any(v is not None for v in pad.values()):
        vals = {k: (v or 0) for k, v in pad.items()}
        lay.append(("Padding", "top {top}, right {right}, bottom {bottom}, left {left}".format(**vals)))
    if n.get("stackSpacing") is not None:
        lay.append(("Gap", n["stackSpacing"]))
    for k, lbl in (("stackCounterSpacing", "Counter gap"), ("stackWrap", "Wrap"),
                   ("stackChildPrimaryGrow", "Child grow"), ("stackChildAlignSelf", "Align self"),
                   ("stackPositioning", "Positioning")):
        if n.get(k) is not None:
            lay.append((lbl, n[k]))
    radii = {k: n.get(k) for k in n if k.startswith("rectangle") and k.endswith("CornerRadius") and n.get(k)}
    if radii:
        lay.append(("Radius", ", ".join(str(v) for v in dict.fromkeys(radii.values()))))
    if lay:
        print("\nLayout:")
        for k, v in lay:
            print(f"  {k:<14} {v}")

    # tokens bound to layout/style fields
    entries = (n.get("variableConsumptionMap") or {}).get("entries") or []
    if entries:
        seen = {}
        for e in entries:
            k = alias_key(e.get("variableData", {}).get("value", {}))
            if k:
                seen.setdefault(token_name(cache, k) or k, []).append(e.get("variableField"))
        if seen:
            print("\nBound tokens:")
            for name, fields in seen.items():
                rec = cache.vars_by_name.get(name)
                val = ""
                if rec and rec.get("value") is not None:
                    v = rec["value"]
                    # A variable can hold a different value per mode (light/dark,
                    # density...). decode.mjs records the first; say so rather than
                    # presenting it as the value. An alias points at another
                    # variable and has no literal value at all.
                    if isinstance(v, dict):
                        val = " = <alias to another variable>"
                    elif rec.get("modes", 1) > 1:
                        val = f" = {v}  (first of {rec['modes']} modes)"
                    else:
                        val = f" = {v}"
                print(f"  {name}{val}")
                print(f"      {', '.join(f for f in fields if f)}")

    # text — the copy itself plus its style, previously only in raw
    if (n.get("textData") or {}).get("characters") is not None:
        print("\nText:")
        print(f"  {text_compact(n, limit=100000)}")
        ah, av = n.get("textAlignHorizontal"), n.get("textAlignVertical")
        if ah or av:
            print(f"  align: {' '.join(x.lower() for x in (ah, av) if x)}")

    # colors — on the node itself and on instance overrides
    paints = list(n.get("fillPaints") or [])
    for ov in n.get("symbolData", {}).get("symbolOverrides", []) or []:
        paints += ov.get("fillPaints") or []
    lines = []
    for p in paints:
        s = fmt_paint(cache, p)
        if s and f"  {s}" not in lines:    # node fills and instance overrides repeat each other
            lines.append(f"  {s}")
    if lines:
        print("\nColors:")
        print("\n".join(lines))

    strokes = [s for s in (fmt_paint(cache, p) for p in n.get("strokePaints") or []) if s]
    if strokes:
        det = []
        if n.get("strokeWeight") is not None:
            det.append(f"w={fmt_num(n['strokeWeight'])}")
        if n.get("strokeAlign"):
            det.append(n["strokeAlign"].lower())
        print("\nStrokes:")
        for s in strokes:
            print(f"  {s}" + (f"  ({' '.join(det)})" if det else ""))

    effs = [e for e in (fmt_effect(e) for e in n.get("effects") or []) if e]
    if effs:
        print("\nEffects:")
        for e in effs:
            print(f"  {e}")

    pi = n.get("prototypeInteractions") or []
    if pi:
        print(f"\nInteractions: {len(pi)}")

    chain = cache.ancestry(nid)[1:]
    if chain:
        print("\nAncestry (nearest first):")
        for c in chain:
            print(f"  {cache.type(c):<10} {cache.name(c)}  ({c})")

    kids = cache.children(nid)
    if kids:
        ids = " ".join(kids[:20]) + (f" … +{len(kids) - 20} more" if len(kids) > 20 else "")
        print(f"\nChildren: {len(kids)} — {ids}")
    elif n.get("type") == "INSTANCE" and sym_id_of(n):
        # An instance stores no children; what it renders is the symbol's tree.
        print(f"\nChildren: 0 — content is on symbol {sym_id_of(n)} (spec {sym_id_of(n)})")
    else:
        print("\nChildren: 0")

    # List exactly what was NOT rendered above. Excluding a whole prefix (e.g. all
    # stack*) hides fields the agent would otherwise never learn exist.
    shown = {"name", "type", "guid", "parentIndex", "symbolData", "symbolDescription",
             "componentPropAssignments", "size", "minSize", "fillPaints",
             "variableConsumptionMap", "prototypeInteractions",
             "stackMode", "stackPrimarySizing", "stackCounterSizing",
             "stackPrimaryAlignItems", "stackCounterAlignItems",
             "stackVerticalPadding", "stackPaddingRight", "stackPaddingBottom",
             "stackHorizontalPadding", "stackSpacing", "stackCounterSpacing",
             "stackWrap", "stackChildPrimaryGrow", "stackChildAlignSelf", "stackPositioning",
             # rendered by the Text/Strokes/Effects sections above
             "textData", "fontName", "fontSize", "lineHeight", "letterSpacing",
             "textAlignHorizontal", "textAlignVertical",
             "strokePaints", "strokeWeight", "strokeAlign", "effects", "opacity",
             # bookkeeping that never changes what gets built
             "visible", "transform", "blendMode", "fillGeometry", "strokeGeometry",
             "styleIdForFill", "styleIdForStrokeFill", "styleIdForText",
             "derivedSymbolData", "overrideKey"}
    rest = sorted(k for k in n if k not in shown and not k.startswith("rectangle"))
    if rest:
        print("\nOther fields on this node (read with `raw --fields`):")
        print("  " + ", ".join(rest))


def cmd_spec(cache, a):
    for idx, node in enumerate(a.node):
        if idx:
            print(f"\n────── {norm_id(node)} ──────\n")
        spec_one(cache, node, a)


def spec_one(cache, node, a):
    """The whole implementable answer for one node in one call: the subtree,
    enriched per node, plus every component it uses — each printed once."""
    nid = norm_id(node)
    if nid not in cache.nodes:
        sys.exit(not_found(cache, nid))
    raws = {}

    def get(i):
        if i not in raws:
            raws[i] = cache.raw(i) or {}
        return raws[i]

    # ---- pass 1: counts and the symbol closure, before anything can truncate
    subtree, order_syms, sym_uses = [], [], {}
    hidden = 0
    stack = [nid]
    while stack:
        i = stack.pop()
        subtree.append(i)
        n = get(i)
        if n.get("visible") is False:
            hidden += 1
        for sid in referenced_symbols(n):
            sym_uses[sid] = sym_uses.get(sid, 0) + 1
            if sid not in order_syms:
                order_syms.append(sid)
        stack.extend(reversed(cache.children(i)))
    subtree_set = set(subtree)
    n_instances = sum(bool(sym_id_of(get(i))) for i in subtree)
    direct_syms = list(order_syms)

    nested_uses = {}
    if a.symbols == "all":
        # BFS through symbol bodies: a component's own instances pull in more
        # components. Dedup keeps «Card_Busca» ×42 from printing 42 times.
        queue = list(order_syms)
        seen = set(order_syms)
        while queue:
            sid = queue.pop(0)
            if sid not in cache.nodes:
                continue
            st = [sid]
            while st:
                i = st.pop()
                sn = get(i)
                for s2 in referenced_symbols(sn):
                    nested_uses[s2] = nested_uses.get(s2, 0) + 1
                    if s2 not in seen:
                        seen.add(s2)
                        order_syms.append(s2)
                        queue.append(s2)
                st.extend(reversed(cache.children(i)))
    expand = order_syms if a.symbols in ("all", "direct") else []

    # ---- rendering
    strip_ids = lambda b: re.sub(r"\d+:\d+", "·", "\n".join(b))

    def block(i, depth):
        n = get(i)
        if not a.keep_hidden and n.get("visible") is False:
            return []
        pad = "  " * depth
        lines = [pad + spec_line(cache, i, n)]
        pl = prop_lines(cache, n)
        if pl:
            lines.append(pad + "    · " + "  ".join(pl))
        for ol in override_lines(cache, n):
            lines.append(pad + "    · " + ol.replace("{id}", i))
        kids = cache.children(i)
        blocks = [block(k, depth + 1) for k in kids]
        j = 0
        while j < len(kids):
            b = blocks[j]
            if not b:
                j += 1
                continue
            k = j + 1
            has_choices = any("symbol choice:" in line for line in b)
            if not a.no_collapse and not has_choices:
                while k < len(blocks) and blocks[k] and strip_ids(blocks[k]) == strip_ids(b):
                    k += 1
            if k - j >= 2:
                lines += b
                ids = [kids[x] for x in range(j + 1, k) if blocks[x]]
                span = f"{ids[0]} … {ids[-1]}" if len(ids) > 1 else ids[0]
                lines.append("  " * (depth + 1) + f"×{k - j} identical siblings ({span})")
                j = k
                continue
            s0 = sym_id_of(get(kids[j]))
            if s0 and not a.no_collapse and not has_choices:
                k = j + 1
                while (k < len(kids) and blocks[k] and sym_id_of(get(kids[k])) == s0
                       and not any("symbol choice:" in line for line in blocks[k])):
                    k += 1
                if k - j >= 4:
                    lines += blocks[j] + blocks[j + 1]
                    lines.append("  " * (depth + 1) +
                                 f"… ×{k - j - 2} more «{sym_label(cache, s0)}» rows "
                                 f"(same structure, copy varies — texts {i} lists all)")
                    j = k
                    continue
            lines += b
            j += 1
        return lines

    root = get(nid)
    out = []
    src = cache.source or {}
    out.append(f"SPEC {root.get('name')} ({nid}) [{root.get('type')}] — {src.get('figFileName') or src.get('fig')}")
    parts = [f"{len(subtree)} nodes" + (f" ({hidden} hidden skipped)" if hidden else "")]
    if n_instances:
        withnested = f" ({len(order_syms)} with nested)" if a.symbols == "all" and len(order_syms) > len(direct_syms) else ""
        parts.append(f"{n_instances} instances of {len(direct_syms)} components{withnested}")
    parts.append(f"copy: texts {nid}")
    out.append(" · ".join(parts))
    out.append("")
    out.append("TREE")
    out += block(nid, 0)

    if expand:
        out.append("")
        out.append("COMPONENT SOURCES (base references and explicit choices; not resolved appearance; ×N = references)")
        for sid in expand:
            uses = sym_uses.get(sid, 0)
            tag = f"×{uses}" if uses else f"×{nested_uses.get(sid, 0)} (nested)"
            out.append(f"«{sym_label(cache, sid)}» ({sid}) {tag}")
            if sid in subtree_set:
                out.append("  (defined inside the tree above)")
            elif sid not in cache.nodes:
                out.append("  (component absent from cache; origin unknown — values may be present in overrides)")
            else:
                out += block(sid, 1)
        if a.symbols == "direct":
            missing = dict.fromkeys(
                s2 for sid in expand if sid in cache.nodes
                for i in _sym_subtree(cache, sid)
                for s2 in referenced_symbols(get(i)) if s2 not in expand)
            if missing:
                out.append("not expanded (use --symbols all): " +
                           ", ".join(f"«{sym_label(cache, s)}» ({s})" for s in missing))

    total = len(out)
    if total > a.max_lines:
        kids = cache.children(nid)
        hint = " ".join(kids[:8])
        cut = out[:a.max_lines]
        cut.append(f"… cut at {a.max_lines} lines — the full spec is {total} lines / {len(subtree)} nodes.")
        cut.append(f"Re-run with --max-lines {total + 20}, or spec one child at a time: spec {hint}")
        out = cut
    out.append(f"Assets: assets {nid} --kind raster (or --name <regex>) — inventory first, then export {nid} --asset <hash> or svg <source-id> (requires original .fig).")
    print("\n".join(out))


def _sym_subtree(cache, sid):
    st, seen = [sid], []
    while st:
        i = st.pop()
        seen.append(i)
        st.extend(cache.children(i))
    return seen


def cmd_tree(cache, a):
    for idx, node in enumerate(a.node):
        if idx:
            print(f"\n────── {norm_id(node)} ──────\n")
        tree_one(cache, node, a)


def tree_one(cache, node, a):
    nid = norm_id(node)
    if nid not in cache.nodes:
        sys.exit(not_found(cache, nid))

    # Count first so headers and truncation can state real totals — "truncated,
    # raise with --limit" with no number forces a guess-and-retry call.
    total, at_depth, maxd = 0, 0, 0
    stack = [(nid, 0)]
    while stack:
        i, d = stack.pop()
        total += 1
        maxd = max(maxd, d)
        if d <= a.depth:
            at_depth += 1
        stack.extend((c, d + 1) for c in cache.children(i))
    print(f"{total} nodes, depth {maxd} — showing depth ≤{a.depth}")

    shown = 0
    skipped = False

    def walk(i, depth):
        nonlocal shown, skipped
        if depth > a.depth:
            return
        if shown >= a.limit:
            skipped = True
            return
        pad = "  " * depth
        extra = ""
        if cache.type(i) == "TEXT":
            n = cache.raw(i)
            t = (n.get("textData") or {}).get("characters")
            if t:
                extra = f'  → "{t[:70]}"'
        print(f"{pad}[{cache.type(i)}] {cache.name(i)} ({i}){extra}")
        shown += 1
        for c in cache.children(i):
            walk(c, depth + 1)

    walk(nid, 0)
    if skipped:
        print(f"... showing {a.limit} of {at_depth} nodes at this depth (raise with --limit)")


def cmd_texts(cache, a):
    for idx, node in enumerate(a.node):
        if idx:
            print(f"\n────── {norm_id(node)} ──────\n")
        texts_one(cache, node, a)


def texts_one(cache, node, a):
    nid = norm_id(node)
    if nid not in cache.nodes:
        sys.exit(not_found(cache, nid))
    out, stack = [], [nid]
    while stack:
        i = stack.pop()
        kind = cache.type(i)
        if kind == "TEXT":
            n = cache.raw(i)
            t = (n.get("textData") or {}).get("characters")
            if t:
                out.append((i, "", t))
        elif kind == "INSTANCE":
            # Copy often lives in a TEXT component property (button labels etc.)
            # rather than a TEXT child — without this, whole CTAs go missing.
            n = cache.raw(i)
            for as_ in n.get("componentPropAssignments") or []:
                did = as_.get("defID", {})
                key = f"{did.get('sessionID',0)}:{did.get('localID',0)}"
                raw_val = as_.get("varValue") or as_.get("value") or {}
                # Only text-shaped assignments are copy: the other shapes in a real
                # export are boolValue and symbolIdValue (an icon swap), and
                # `scalar` can also yield a "<token ...>" string. text_value is the
                # shared predicate, so this cannot drift from what `inspect` shows.
                val = text_value(raw_val)
                if isinstance(val, str) and val:
                    out.append((i, f"[{cache.prop_name(key) or 'prop'}] ", val))
            # Per-row copy lives in overrides: text set on nodes deep inside the
            # symbol, reachable from nowhere else — real sections carry dozens.
            for ov in (n.get("symbolData") or {}).get("symbolOverrides") or []:
                t = (ov.get("textData") or {}).get("characters")
                if t:
                    out.append((i, "[override] ", t))
        stack.extend(reversed(cache.children(i)))
    limit = a.limit if a.limit is not None else len(out)
    print(f"{len(out)} texts under {nid}")
    for i, tag, t in out[:limit]:
        print(f"{i:>14}  {tag}{t}")
    if len(out) > limit:
        print(f"... showing {limit} of {len(out)} (raise with --limit or drop it)")


def name_filter(pattern):
    """The one name matcher in this skill, shared by find and assets.

    Layer names rarely carry the spaces the design shows — they use -, _ or
    nothing — so a pattern with spaces is retried once, loosened, and the
    caller is told which pattern actually matched.
    """
    rx = re.compile(pattern, re.I)
    loose = re.sub(r"\s+", "[-_ .]?", pattern) if re.search(r"\s", pattern) else None

    def apply(items, names):
        hits = [i for i in items if any(n and rx.search(n) for n in names(i))]
        if hits or not loose:
            return hits, None
        rx_loose = re.compile(loose, re.I)
        hits = [i for i in items if any(n and rx_loose.search(n) for n in names(i))]
        return hits, (f"no matches for '{pattern}' — showing matches for '{loose}':" if hits else None)

    return apply


def cmd_find(cache, a):
    items = [(i, r) for i, r in cache.nodes.items() if not (a.type and r[1] != a.type.upper())]
    hits, note = name_filter(a.pattern)(items, lambda item: (item[1][0],))
    if note:
        print(note)
    if not hits:
        print("no matches")
        return
    print(f"{len(hits)} matches")
    for i, r in hits[:a.limit]:
        print(f"  [{r[1]}] {r[0]}  ({i})")
    if len(hits) > a.limit:
        print(f"... showing {a.limit} of {len(hits)} (raise with --limit)")


def cmd_raw(cache, a):
    for idx, node in enumerate(a.node):
        if idx:
            print(f"\n────── {norm_id(node)} ──────\n")
        raw_one(cache, node, a)


def raw_one(cache, node, a):
    nid = norm_id(node)
    n = cache.raw(nid)
    if n is None:
        sys.exit(not_found(cache, nid))
    if a.fields:
        want = [f.strip() for f in a.fields.split(",")]
        print(json.dumps({k: n.get(k) for k in want}, indent=2, ensure_ascii=False))
    else:
        # Scalars print inline — a bare `raw` that only listed field names was a
        # guaranteed second call.
        print(f"Fields on {nid} (scalars inline; --fields a,b,c for the rest):")
        for k in sorted(n):
            v = n[k]
            if isinstance(v, (bool, int, float)) or (isinstance(v, str) and len(v) <= 80):
                print(f"  {k:<38} {v!r}")
            else:
                kind = type(v).__name__
                size = f" ({len(v)})" if isinstance(v, (list, dict, str)) else ""
                print(f"  {k:<38} {kind}{size}")


# --------------------------------------------------------------------------- main

def image_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"BM"):
        return "bmp"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if data[4:8] == b"ftyp" and data[8:12] in (b"avif", b"avis"):
        return "avif"
    return "bin"


def assets_file_keys(refs):
    keys = set()
    for ref in refs:
        if "://" not in ref:
            continue
        match = re.search(r"/(?:design|file)/([A-Za-z0-9]+)", ref)
        if not match or not re.search(r"[?&]node-id=\d+[-:]\d+", ref):
            sys.exit("assets needs a Figma node URL containing a file key and node-id.")
        keys.add(match.group(1))
    if len(keys) > 1:
        sys.exit("assets accepts one document per batch; query different file keys separately.")
    return keys


def asset_inventory(cache, a):
    keys = assets_file_keys(a.node)
    file_key = cache.source.get("urlFileKey")
    if keys and keys != {file_key}:
        sys.exit("assets URL does not match the cache file key; decode the correct .fig with --url, then retry.")
    ids = [norm_id(ref) for ref in a.node]
    if any(not re.fullmatch(r"\d+:\d+", node) for node in ids):
        sys.exit("assets needs node IDs (123:456 or 123-456) or Figma node URLs.")
    fig = cache.source.get("figPath")
    if not fig or not Path(fig).is_file():
        sys.exit("assets needs the original .fig: restore it at the cached figPath or run decode.mjs on a new local export.")
    if not shutil.which("node"):
        sys.exit("assets needs Node >= 22.15; install Node and retry.")
    request = {"figPath": fig, "fileKey": file_key, "nodes": ids}
    script = Path(__file__).resolve().parent / "assets.mjs"
    result = subprocess.run(["node", str(script)], input=json.dumps(request), capture_output=True, text=True)
    if result.returncode:
        sys.exit(result.stderr.strip() or "assets decode failed; run decode.mjs on the .fig to diagnose it.")
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return json.loads(result.stdout)


def short_path(path, root, head=1, tail=2):
    """An occurrence path relative to the queried root, middle elided.

    Ancestor paths were 74% of this command's output bytes: depth averages 15
    in a real section and the first elements repeat on every record. The ends
    are what identify an occurrence; the middle is what costs.
    """
    start = next((i for i, part in enumerate(path) if part["id"] == root), 0)
    parts = path[start:] or path[-1:]
    label = lambda part: part["name"] or part["type"]
    if len(parts) <= head + tail + 1:
        kept = [label(part) for part in parts]
    else:
        kept = [label(part) for part in parts[:head]] + ["…"] + [label(part) for part in parts[-tail:]]
    return " / ".join(kept) + f" ({parts[-1]['id']})"


def short_reason(text):
    """First sentence of an exporter error, capped — the inventory needs why it
    cannot export, not the whole remedy; that stays in the svg command itself."""
    first = re.split(r"(?<=\.)\s", text.strip(), maxsplit=1)[0]
    return first if len(first) <= 120 else first[:117] + "…"


def representative(occurrences):
    """A plainly referenced occurrence when there is one: an asset also reached
    through a hidden layer or a replaced default is still, first, the one the
    design shows."""
    return next((o for o in occurrences if o["state"] == "referenced"), occurrences[0])


def occurrence_states(occurrences):
    order = ("referenced", "overridden", "hidden", "unresolved")
    found = {o["state"] for o in occurrences}
    return [state for state in order if state in found] + sorted(found - set(order))


def asset_records(cache, root):
    """One record per distinct asset — the inventory level.

    Occurrences are evidence and stay out of it: a real section holds 370
    distinct assets against 8857 occurrences, so repeating the justification
    under every record made this command cost 200x its own answer.
    """
    records = []
    for item in root["files"]:
        occurrences = item["occurrences"]
        rep = representative(occurrences)
        records.append({
            "kind": "raster", "identity": item["hash"], "hash": item["hash"], "selector": item["selector"],
            "name": rep.get("imageName") or rep["path"][-1]["name"] or "",
            "exportable": True, "reason": None,
            "command": f"export {root['root']} --asset {item['selector']}",
            "occurrenceCount": len(occurrences), "states": occurrence_states(occurrences),
            "representative": {"sourceNode": rep["sourceNode"], "origin": rep["origin"], "state": rep["state"],
                               "path": short_path(rep["path"], root["root"]), "pathDepth": len(rep["path"]),
                               "paintDimensions": rep.get("paintDimensions")},
            "_names": {o.get("imageName") or "" for o in occurrences} | {o["path"][-1]["name"] for o in occurrences},
            "_occurrences": occurrences,
        })
    for item in root["vectors"]:
        occurrences = item["occurrences"]
        rep = representative(occurrences)
        svg = item["svg"]
        records.append({
            "kind": "vector", "identity": item["sourceNode"], "sourceNode": item["sourceNode"],
            "name": item["name"], "type": item["type"], "parent": item.get("parent"), "size": item.get("size"),
            "exportable": svg["supported"], "reason": None if svg["supported"] else short_reason(svg["reason"]),
            "command": svg["command"] if svg["supported"] else None, "digest": svg.get("digest"),
            "warnings": svg.get("warnings", []), "appearance": svg.get("appearance"),
            "occurrenceCount": len(occurrences), "states": occurrence_states(occurrences),
            "representative": {"sourceNode": rep["sourceNode"], "origin": rep["origin"], "state": rep["state"],
                               "path": short_path(rep["path"], root["root"]), "pathDepth": len(rep["path"])},
            "_names": {item["name"], (item.get("parent") or {}).get("name") or ""},
            "_occurrences": occurrences,
        })
    label_containment(cache, records)
    return collapse_identical(records)


def collapse_identical(records):
    """Two candidates that export byte-identical SVG are one asset.

    An icon SYMBOL and the single VECTOR inside it produce the same bytes — the
    SYMBOL is the vector's own enclosing frame, so viewBox and transform
    coincide. A SYMBOL holding two vectors, or one wrapping an inner FRAME, does
    not, and stays a separate record. The digest decides it per asset instead of
    a rule about types; the collapsed identities stay listed and queryable.
    """
    groups, kept = {}, []
    for record in records:
        digest = record.get("digest") if record["kind"] == "vector" and record["exportable"] else None
        if digest is None:
            kept.append(record)
            continue
        if digest not in groups:
            groups[digest] = record
            record["sameOutput"] = []
            record["_collapsed"] = []
            kept.append(record)
            continue
        primary = groups[digest]
        # Prefer the outermost node: it is what the design references, and the
        # nested one remains reachable through sameOutput.
        if primary["identity"] in (record.get("contains") or []):
            primary, record = record, primary
            groups[digest] = primary
            primary["sameOutput"], primary["_collapsed"] = record["sameOutput"], record["_collapsed"]
            record["sameOutput"], record["_collapsed"] = [], []
            kept[kept.index(record)] = primary
        primary["sameOutput"].append(record["identity"])
        primary["_collapsed"].append(record)
        primary["_names"] = primary["_names"] | record["_names"]
    alias = {other: record["identity"] for record in kept for other in record.get("sameOutput") or []}
    survivors = {record["identity"] for record in kept}
    for record in kept:
        if record["kind"] != "vector":
            continue
        inside = alias.get(record.get("inside"), record.get("inside"))
        record["inside"] = inside if inside in survivors and inside != record["identity"] else None
        record["contains"] = sorted({alias.get(i, i) for i in record.get("contains") or []}
                                    & survivors - {record["identity"]})
    return kept


def label_containment(cache, records):
    """Name the SYMBOL/VECTOR relation instead of collapsing it.

    A supported SYMBOL usually holds a supported VECTOR, but they are not the
    same export: the SYMBOL keeps its own frame as viewBox and emits every
    visible vector under it, so a two-vector SYMBOL is not its first child.
    Verified by fixture in tests/vector-svg.test.mjs.
    """
    vectors = [r for r in records if r["kind"] == "vector"]
    ids = {r["identity"] for r in vectors}
    chains = {r["identity"]: cache.ancestry(r["identity"])[1:] for r in vectors}
    for record in vectors:
        record["inside"] = next((a for a in chains[record["identity"]] if a in ids), None)
        record["contains"] = sorted(other["identity"] for other in vectors
                                    if record["identity"] in chains[other["identity"]])


def asset_counts(records):
    kinds = {kind: [r for r in records if r["kind"] == kind] for kind in ("raster", "vector")}
    return {"rasters": len(kinds["raster"]),
            "rastersExportable": sum(1 for r in kinds["raster"] if r["exportable"]),
            "vectors": len(kinds["vector"]),
            "vectorsExportable": sum(1 for r in kinds["vector"] if r["exportable"]),
            "occurrences": sum(r["occurrenceCount"] for r in records)}


def asset_header(root_id, counts):
    return (f"Assets in {root_id}: {counts['rasters']} rasters ({counts['rastersExportable']} exportable), "
            f"{counts['vectors']} vectors ({counts['vectorsExportable']} exportable), "
            f"{counts['occurrences']} occurrences")


def asset_line(record):
    parts = [f"{record['kind']} ×{record['occurrenceCount']}"]
    if record["name"]:
        parts.append(f'"{record["name"]}"')
    if record["kind"] == "vector":
        parts.append(record["type"])
        if not record["command"]:
            parts.append(record["identity"])
    if record["states"] != ["referenced"]:
        parts.append("[" + "+".join(record["states"]) + "]")
    if record.get("inside"):
        parts.append(f"inside {record['inside']}")
    if record.get("sameOutput"):
        parts.append(f"= {', '.join(record['sameOutput'])}")
    tail = record["command"] or f"not exportable: {record['reason']}"
    return "  " + " ".join(parts) + f" · {record['representative']['path']} · {tail}"


def occurrence_lines(record, root_id, limit):
    lines = []
    for occurrence in record["_occurrences"][:limit]:
        # The instance chain, not the elided middle of the path, is what tells two
        # occurrences of one component apart — four siblings of the same component
        # share every name in the path.
        via = "/".join(occurrence.get("instances") or [])
        lines.append(f"    [{occurrence['state']}] {occurrence['origin']} source={occurrence['sourceNode']}"
                     f"{f' via {via}' if via else ''} — {short_path(occurrence['path'], root_id, tail=3)}")
        selection = occurrence.get("selection")
        if selection:
            lines.append(f"      selection: {json.dumps(selection, ensure_ascii=False)}")
        if record["kind"] == "raster":
            dims = occurrence["paintDimensions"]
            lines.append(f"      paint={occurrence['paint']} guidPath={'/'.join(occurrence['guidPath']) or '-'}"
                         f" dimensions={dims['width']}×{dims['height']} (paint metadata)")
    if len(record["_occurrences"]) > limit:
        lines.append(f"    … showing {limit} of {len(record['_occurrences'])} occurrences (raise with --limit)")
    return lines


def public_record(record, occurrences=None, root_id=None):
    out = {k: v for k, v in record.items() if not k.startswith("_")}
    if occurrences is not None:
        out["occurrences"] = record["_occurrences"][:occurrences]
        out["occurrencesTruncated"] = len(record["_occurrences"]) > occurrences
    return out


def select_assets(records, a, limit):
    """Filters in the inventory's own units — records, not lines or bytes."""
    kind, pattern = getattr(a, "kind", None), getattr(a, "name", None)
    selected = [r for r in records
                if (not kind or r["kind"] == kind)
                and (not getattr(a, "exportable", False) or r["exportable"])]
    note = None
    if pattern:
        selected, note = name_filter(pattern)(selected, lambda r: r["_names"])
    return selected[:limit], len(selected), note


def resolve_wanted(records, wanted):
    """Evidence for an identity the inventory printed — including one collapsed
    into another record, which is still a real node with its own occurrences."""
    selected = []
    for record in records:
        if record["identity"].lower() in wanted:
            selected.append(record)
            continue
        selected.extend(c for c in record.get("_collapsed") or [] if c["identity"].lower() in wanted)
    return selected


def cmd_assets(cache, a):
    wanted = [value.lower() for value in (getattr(a, "occurrences", None) or [])]
    if wanted and (getattr(a, "kind", None) or getattr(a, "name", None) or getattr(a, "exportable", False)):
        sys.exit("assets: --occurrences selects assets by identity; drop --kind, --name and --exportable.")
    limit = getattr(a, "limit", None) or 30
    as_json = getattr(a, "json", False)
    inventory = asset_inventory(cache, a)
    document, roots, matched = inventory["document"], [], set()
    if not as_json:
        print(f"Document: {document['figPath']} (file key: {document['fileKey'] or 'untagged'})")
    for root in inventory["roots"]:
        records = asset_records(cache, root)
        counts = asset_counts(records)
        note = None
        if wanted:
            selected = resolve_wanted(records, wanted)
            matched.update(r["identity"].lower() for r in selected)
            total = len(selected)
        else:
            selected, total, note = select_assets(records, a, limit)
        if as_json:
            roots.append({"root": root["root"], "counts": counts, "matched": total, "shown": len(selected),
                          "level": "occurrences" if wanted else "inventory",
                          "assets": [public_record(r, limit if wanted else None) for r in selected],
                          "warnings": root["warnings"], "errors": root["errors"],
                          "limits": root.get("limits", [])})
        else:
            print(f"\n{asset_header(root['root'], counts)}")
            if note:
                print(f"  {note}")
            for record in selected:
                print(asset_line(record))
                if wanted:
                    print("\n".join(occurrence_lines(record, root["root"], limit)))
            if total > len(selected):
                print(f"  … showing {len(selected)} of {total} records (raise with --limit)")
            if not wanted and counts["occurrences"]:
                print(f"  Evidence: assets {root['root']} --occurrences <hash|source-id>"
                      f" · filters: --kind raster|vector --exportable --name <regex>")
            for limit_text in root.get("limits", []):
                print(f"  Limit: {limit_text}")
    if as_json:
        print(json.dumps({"version": 2, "document": document, "roots": roots}, ensure_ascii=False, indent=2))
    for root in inventory["roots"]:
        for level in ("warnings", "errors"):
            for message in root[level]:
                print(f"assets {root['root']}: {message}", file=sys.stderr)
    unknown = [value for value in wanted if value not in matched]
    if unknown:
        sys.exit(f"assets: no asset with identity {', '.join(unknown)} in the requested roots; "
                 "run assets without --occurrences to list identities.")
    if any(root["errors"] for root in inventory["roots"]):
        sys.exit(1)


def cmd_export(cache, a):
    if not a.asset and not a.all_references:
        print("export: choose --asset <hash> or --all-references explicitly; no assets written.", file=sys.stderr)
        cmd_assets(cache, a)
        sys.exit(2)
    if a.asset:
        root = asset_inventory(cache, a)["roots"][0]
        for warning in root["warnings"]:
            print(f"export {root['root']}: {warning}", file=sys.stderr)
        if root["errors"]:
            sys.exit("; ".join(root["errors"]))
        available = {asset["hash"]: asset for asset in root["files"]}
        missing = [value for value in a.asset if value not in available]
        if missing:
            sys.exit(f"export: hashes not referenced by {root['root']}: {', '.join(missing)}; run assets for this root again.")
        selected = []
        for value in dict.fromkeys(a.asset):
            sources = [{"node": occurrence["sourceNode"],
                        "name": occurrence["path"][-1]["name"],
                        "kind": f"{occurrence['origin']} [{occurrence['state']}]",
                        "path": [f"{part['name']} ({part['id']})" for part in occurrence["path"]],
                        "paint": occurrence["paint"]}
                       for occurrence in available[value]["occurrences"]]
            selected.append({"hash": value, "sources": sources})
        items = [{"id": root["root"], "assets": selected, "warnings": [], "errors": []}]
    else:
        items = raw_export_inventory(cache, a)
    fig = cache.source.get("figPath")
    write_raster_assets(fig, items, a.out)


def raw_export_inventory(cache, a):
    fig = cache.source.get("figPath")
    if not fig or not Path(fig).is_file():
        sys.exit("export needs the original .fig: restore it at the cached figPath or run decode.mjs on a new local export.")
    if not shutil.which("node"):
        sys.exit("export needs Node >= 22.15; install Node and retry.")
    request = {"figPath": fig, "nodes": [norm_id(n) for n in a.node]}
    script = Path(__file__).resolve().parent / "export.mjs"
    result = subprocess.run(["node", str(script)], input=json.dumps(request), capture_output=True, text=True)
    if result.returncode:
        sys.exit(result.stderr.strip() or "export decode failed; run decode.mjs on the .fig to diagnose it.")
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return json.loads(result.stdout)


def write_raster_assets(fig, items, output):
    digest = hashlib.sha1(str(Path(fig).resolve()).encode()).hexdigest()[:12]
    out = Path(output).expanduser() if output else Path(tempfile.gettempdir()) / "figma-read" / "assets" / digest
    failed, written = False, {}
    for item in items:
        for warning in item["warnings"]:
            print(f"export {item['id']}: {warning}", file=sys.stderr)
        for error in item["errors"]:
            print(f"export {item['id']}: {error}", file=sys.stderr)
            failed = True
        for asset in item["assets"]:
            hash_value = asset["hash"]
            try:
                if hash_value not in written:
                    extraction = subprocess.run(["unzip", "-p", fig, f"images/{hash_value}"], capture_output=True)
                    if extraction.returncode or not extraction.stdout:
                        raise OSError(f"images/{hash_value} is missing, empty or unreadable; re-export the .fig.")
                    data = extraction.stdout
                    extension = image_extension(data)
                    if extension == "bin":
                        print(f"export {item['id']}: unknown image format for {hash_value}; preserving bytes as .bin.", file=sys.stderr)
                    path = out / f"{hash_value}.{extension}"
                    out.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                    written[hash_value] = path
                for source in asset["sources"]:
                    origin = f"{source['node']} ({source['name']}) {source['kind']}"
                    if source.get("path"):
                        origin += " " + "/".join(source["path"])
                    origin += f" fillPaints[{source['paint']}]"
                    print(f"{item['id']} ← {origin} → {written[hash_value]}")
            except OSError as error:
                print(f"export {item['id']}: {error}", file=sys.stderr)
                failed = True
    if failed:
        sys.exit(1)


def cmd_svg(cache, a):
    fig = cache.source.get("figPath")
    if not fig or not Path(fig).is_file():
        sys.exit("svg needs the original .fig: restore it at the cached figPath or run decode.mjs on a new local export.")
    if not shutil.which("node"):
        sys.exit("svg needs Node >= 22.15; install Node and retry.")
    request = {"figPath": fig, "nodes": [norm_id(n) for n in a.node], "currentColor": a.current_color}
    script = Path(__file__).resolve().parent / "svg.mjs"
    result = subprocess.run(["node", str(script)], input=json.dumps(request), capture_output=True, text=True)
    if result.returncode:
        sys.exit(result.stderr.strip() or "svg decode failed; run decode.mjs on the .fig to diagnose it.")
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    digest = hashlib.sha1(str(Path(fig).resolve()).encode()).hexdigest()[:12]
    out = Path(a.out).expanduser() if a.out else Path(tempfile.gettempdir()) / "figma-read" / "assets" / digest
    failed = False
    for item in json.loads(result.stdout):
        if "error" in item:
            print(f"svg {item['id']}: {item['error']}", file=sys.stderr)
            failed = True
            continue
        for warning in item["warnings"]:
            print(f"svg {item['id']}: {warning}", file=sys.stderr)
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", item.get("name") or "vector").strip(".-")[:60] or "vector"
        suffix = "-currentColor" if a.current_color else ""
        path = out / f"{slug}-{item['id'].replace(':', '-')}{suffix}.svg"
        try:
            out.mkdir(parents=True, exist_ok=True)
            path.write_text(item["svg"], encoding="utf-8")
        except OSError as error:
            print(f"svg {item['id']}: cannot write {path}: {error}", file=sys.stderr)
            failed = True
            continue
        print(f"{item['id']} → {path}")
    if failed:
        sys.exit(1)


def main():
    global AUTODECODE
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir")
    p.add_argument("--no-decode", action="store_true", help="never auto-run decode.mjs to recover a purged cache")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(s):
        # Also accepted after the subcommand (`inspect X --dir D`); SUPPRESS so
        # an absent flag here does not clobber a value given before it.
        s.add_argument("--dir", default=argparse.SUPPRESS)
        s.add_argument("--no-decode", action="store_true", default=argparse.SUPPRESS)
        return s

    common(sub.add_parser("info"))
    s = common(sub.add_parser("assets", help="inventory the distinct assets of a node: one record each, no asset writes"))
    s.add_argument("node", nargs="+")
    s.add_argument("--json", action="store_true", help="structured inventory; obeys the same default, filters and limit")
    s.add_argument("--kind", choices=("raster", "vector"), help="keep only raster files or only vector candidates")
    s.add_argument("--exportable", action="store_true", help="keep only what this skill can export today")
    s.add_argument("--name", help="regex over asset and layer names (same matcher as find)")
    s.add_argument("--occurrences", action="append", metavar="HASH|SOURCE-ID",
                   help="evidence level: print the occurrence chains of this asset; repeatable")
    s.add_argument("--limit", type=int, default=30, help="max records, and max occurrences per asset (default 30)")
    s = common(sub.add_parser("svg"))
    s.add_argument("node", nargs="+")
    s.add_argument("--out", help="output directory (default: temporary figma-read assets directory)")
    s.add_argument("--current-color", action="store_true", help="use currentColor for a monochrome icon")
    s = common(sub.add_parser("export", help="export selected raster hashes or explicit --all-references; without a mode, list candidates without writing", description="Choose --asset HASH or --all-references. Without either, list candidates, write nothing and return status 2."))
    s.add_argument("node", nargs="+")
    s.add_argument("--out", help="output directory (default: temporary figma-read assets directory)")
    mode = s.add_mutually_exclusive_group()
    mode.add_argument("--asset", action="append", help="complete raster hash from assets; repeat to select multiple files within one root")
    mode.add_argument("--all-references", action="store_true", help="export raw references, including hidden layers and replaced defaults")
    sub.add_parser("list")
    s = sub.add_parser("config")
    s.add_argument("--set-when-no-fig", choices=sorted(WHEN_NO_FIG))
    for name in ("inspect", "raw"):
        s = common(sub.add_parser(name))
        s.add_argument("node", nargs="+")
        if name == "raw":
            s.add_argument("--fields")
    s = common(sub.add_parser("spec"))
    s.add_argument("node", nargs="+")
    s.add_argument("--symbols", choices=("all", "direct", "none"), default="all")
    s.add_argument("--max-lines", type=int, default=600)
    s.add_argument("--no-collapse", action="store_true")
    s.add_argument("--keep-hidden", action="store_true")
    s = common(sub.add_parser("tree")); s.add_argument("node", nargs="+"); s.add_argument("--depth", type=int, default=3); s.add_argument("--limit", type=int, default=200)
    s = common(sub.add_parser("texts")); s.add_argument("node", nargs="+"); s.add_argument("--limit", type=int, default=None)
    s = common(sub.add_parser("find")); s.add_argument("pattern"); s.add_argument("--type"); s.add_argument("--limit", type=int, default=30)

    a = p.parse_args()
    if a.cmd == "export" and a.asset:
        if len(a.node) != 1:
            p.error("--asset requires exactly one root")
        if any(not re.fullmatch(r"[0-9a-fA-F]{40}", value) for value in a.asset):
            p.error("--asset requires a complete 40-character hexadecimal hash from assets")
        a.asset = [value.lower() for value in a.asset]
    if a.no_decode:
        AUTODECODE = False
    if a.cmd in ("list", "config"):
        return {"list": cmd_list, "config": cmd_config}[a.cmd](None, a)
    nodes = getattr(a, "node", None)
    ref = (nodes[0] if isinstance(nodes, list) and nodes else nodes) or getattr(a, "pattern", None)
    if a.cmd == "assets" or (a.cmd == "export" and not a.all_references):
        assets_file_keys(a.node)
    cache = Cache(resolve_dir(a.dir, ref))
    {"info": cmd_info, "inspect": cmd_inspect, "spec": cmd_spec, "tree": cmd_tree,
     "texts": cmd_texts, "find": cmd_find, "raw": cmd_raw, "svg": cmd_svg, "export": cmd_export, "assets": cmd_assets}[a.cmd](cache, a)


if __name__ == "__main__":
    main()
