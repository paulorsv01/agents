---
name: figma-read
description: Read a Figma design offline from a .fig export — layer tree, copy, component properties, layout, colors, design-token names, and original vector or raster assets — without the Figma API or auth. Use when a .fig export or decoded cache exists, when the user shares a .fig file, and on a figma.com/design URL or a request to inspect, read or implement a design, screen, component or frame.
---

# figma-read

Reads a designer-exported `.fig` directly. Everything the Figma inspect panel shows —
component properties, layout, colors, bound design tokens — and its original vector and
raster assets are inside the file.

## When this skill applies

It needs a local `.fig`. A cache or a `.fig` on disk → use it, nothing to ask (the Quick
start below is one command either way: decode is a no-op when the cache is current, and a
purged cache re-decodes itself). Only when **no `.fig` exists at all**, check the recorded
preference with `query.py config`:

- `always` — this skill is the way designs get read here. Ask the user to export
  (**Figma → File → Save local copy**) and where they saved it. Do not fall back.
- `mcp` — use the Figma MCP instead; don't ask for an export.
- `ask` — ask the user which they want this time.
- **unset** — ask once, explain the trade-off, and offer to record the answer with
  `query.py config --set-when-no-fig <always|ask|mcp>` so it isn't asked again.

The trade-off to state when asking: a `.fig` is one manual export that then gives the whole
document offline, with no rate limits and no auth, and stays reusable. The MCP needs no export
but costs a call per node, needs auth, and rate-limits partway through larger reads. The export
is a snapshot, so it goes stale when designers keep working.

## Quick start — one command answers "implement this screen"

The user exports once: **Figma → File → Save local copy**. Then chain decode and query in a
single invocation:

```bash
node <skill>/scripts/decode.mjs "<file.fig>" --url "<figma-url>" && \
python3 <skill>/scripts/query.py spec "<figma-url-or-node-id>"
```

`spec` prints the whole subtree — layout, sizes, colors with token names, copy, fonts,
effects — plus every component it uses, each printed once. Decode is skipped when the cache
is already current, so the chain costs nothing to repeat. If the cache was purged from
`$TMPDIR`, `query.py` re-decodes on its own (disable with `--no-decode`).

**`<skill>` is the absolute directory this `SKILL.md` was loaded from — write it out in full,
every call.** The scripts sit beside this file, not under the working directory: the cwd is the
user's project, and when the skill is installed as a plugin it lives in a cache elsewhere, so a
bare `scripts/query.py` will not exist. A shell variable is no help either — each command runs in
its own shell, so an assignment made in one call is gone by the next.

`decode.mjs` writes its cache under **`$TMPDIR/figma-read/`** — never into the project. Always
pass `--url`: it tags the cache with the file key so any later node URL resolves to the right
design automatically. Use `--out <dir>` if a cache needs to persist; `query.py` reads with
`--dir`. Node ids come from the URL: `node-id=8099-18638` → `8099:18638`; both forms and the
full URL are accepted.

The cache directory is keyed by the `.fig` **path**, so re-exporting the same design to a new
path (Downloads first, then the project) leaves two caches under one file key. `decode.mjs`
says so when it creates the second one, and a query given a URL picks the cache whose `.fig`
is newest, naming its choice and the `--dir` that forces the other. A bare node id still
refuses to guess. Nothing chooses silently.

## Commands

All of these are `python3 <skill>/scripts/query.py …`, abbreviated here to `query.py`.
**Node-taking commands accept batches**, except `export --asset`, which requires one root.

```bash
query.py spec  <node> [<node>…]      # the whole implementable answer — start here
query.py texts <node>                # all copy: TEXT nodes, props AND overrides
query.py inspect <node> [<node>…]    # single-node deep dive (inspect panel + text/effects)
query.py tree  <node> --depth 3      # bare hierarchy when spec is more than needed
query.py find  <regex> --type TEXT   # locate by layer name (auto-loosens spaces)
query.py raw   <node> --fields a,b   # anything not covered above
query.py assets <node> [<node>…] --kind raster  # one line per distinct asset, no asset writes
query.py svg   <node> [<node>…] --current-color  # filled vectors as SVG
query.py export <node> --asset <hash>  # exactly the selected original image, byte-for-byte
query.py list | info | config       # what is decoded / file stats / preference
```

`spec` flags: `--symbols all|direct|none` (default `all` — follow instances into their
components, deduped), `--max-lines N` (default 600; the cut always states the real totals),
`--no-collapse`, `--keep-hidden`.

`svg` re-decodes the original `.fig` once per batch; keep that file available. It writes
one SVG per requested node under `$TMPDIR/figma-read/assets/`, or to `--out <directory>`.
Omit `--current-color` to keep the design's literal color; semantic tokens are retained in
`data-figma-token`. `--current-color` requires a monochrome icon.

Select a filled `VECTOR` or its icon `SYMBOL`/`FRAME`. Containers collect visible vectors,
skip hidden construction subtrees, and warn about multiple vectors or omitted container
paints. Instance overrides, boolean operations, parametric shapes, strokes, gradients,
effects and rounded vector corners are unsupported: select the source component, or
outline/flatten the artwork in Figma and re-export. A vector uses its enclosing frame's
size as the viewBox, preserving padding; normalized geometry is scaled to its node size
before applying transforms. Each region gets its own path: binary `windingRule=0` means
`evenodd`, and `1` means `nonzero`.

## Discovering assets in context

`query.py assets <node-or-url> [<node-or-url>…]` lists the distinct assets of a node without
extracting images or writing asset files. It needs the original `.fig`, decodes once per
batch, and accepts one document per invocation. URLs must match the cache's file key (tag it
with `decode.mjs --url`); `--dir` also accepts plain node IDs.

**Two levels.** The default is the inventory: a count header, then **one line per distinct
asset** — identity, name, type, occurrence count, state, a representative path relative to
the queried root, and the ready `export …--asset <hash>` or `svg <id>` command (or why it
cannot be exported). Evidence is asked for per asset with
`--occurrences <hash|source-id>` (repeatable), which prints that asset's occurrence chains.
This matters: a real section holds 370 distinct assets against 8857 occurrences, so the
default answers "what can I take from here" in ~35 lines where the full evidence was 15k.

Filters: `--kind raster|vector`, `--exportable`, `--name <regex>` (the same matcher as `find`,
including the retry that loosens spaces). `--limit` caps records — and occurrences inside
`--occurrences` — in `find`'s form, with the cut stating the real total. `--json` obeys the
same default, filters and limit; do not reach for it to bypass them.

Two candidates whose exported SVG is byte-identical are **one record**: an icon SYMBOL and
the single VECTOR inside it export the same bytes, so the extra identities are listed as
`= <id>` and stay queryable. A SYMBOL holding two vectors exports both, is not equivalent to
either, and stays a separate record labelled `inside <id>`. The digest decides this per
asset; it is not a rule about types.

The versioned JSON (`version: 2`) has `document` and `roots`; each root has `counts`,
`matched`, `shown`, `assets`, `warnings` and `errors`. Raster records use a complete hash
selector; vector records carry the source ID, parent, type and `svg <id>` command with the
converter's support check. A supported SVG represents the source; instance colors, size and
overrides are not incorporated. Paint dimensions are metadata, not measurements of extracted
image bytes. Under `--occurrences`, each record also carries its full occurrences: node path,
instance chain, origin, selection, paint index and override guidPath.

Origins (`fill`, `override`, `component-default`, `property-swap`) are separate from state:
`referenced` means a reference was found, not proven final visibility; `hidden` records known
invisibility; `overridden` requires a proven target/replacement; `unresolved` preserves an
uncertain relationship. The `known` flags retain overlapping states. Hidden ancestors and
paints are retained. Swaps follow both instance and override symbol properties; full guidPaths
and published node aliases resolve targets where possible. A unique `OVERRIDDEN_SYMBOL_ID`
property binding proves a replacement slot; missing or ambiguous bindings do not. A missing
target does not invalidate a present selected symbol or prove an external library origin.

Use this inventory to distinguish a thumbnail override, its replaced default and an unrelated
banner by their names, states and paths — `--kind raster` usually settles it in three lines.
Unknown masks, crop, variable modes and arbitrary overrides are not rendered. Use
`export <same-root> --asset <hash>` to extract a chosen raster candidate.

## Extracting original raster assets

```bash
python3 <skill>/scripts/query.py export <node-or-url> --asset <hash> [--asset <hash>…] [--out <directory>]
python3 <skill>/scripts/query.py export <node-or-url> [<node-or-url>…] --all-references [--out <directory>]
```

`export --asset` accepts one root and complete 40-character hexadecimal hashes from
`assets`. All selectors must belong to that root in the current source before any image is
extracted or output directory created. Repeated hashes write once. Explicit selection can
include hidden, replaced or unresolved references; it does not assert final visibility.
Invalid selections never fall back to exporting everything. Later I/O failures preserve
files already written and return status 1. `--asset` cannot combine with `--all-references`.

`export --all-references` re-decodes the original `.fig` and extracts `images/<hash>` byte-for-byte.
It inventories image fills in the subtree, instance overrides and recursively referenced
local components, including hidden layers and component defaults replaced by overrides.
It does not resolve the final rendered appearance, crops, masks or effects. Output lists
the source node and override path for each reference; shared hashes produce one file per
batch. Missing library components produce a warning; available local references still export.

With neither flag, `export` lists contextual candidates and selection commands, writes no
assets (even for a single candidate), and returns usage status 2. Discovery failures return
status 1. Use `--all-references` for a raw inventory export; that mode does not render a screen.

Files are named by hash with a signature-detected extension (PNG, JPEG, GIF, WebP, BMP,
TIFF or AVIF); unknown formats keep their bytes as `.bin` with a warning. The default
output directory is the same temporary assets directory as `svg`. `thumbnail.png` is the
document preview and is never exported; `imageThumbnail` previews are also excluded.
Nodes without image references and missing archive entries give clear errors. Batch
successes remain on disk when another node fails; any failure returns exit status 1.

## Using assets while implementing a design

Read `spec <root>` for structure, then narrow the assets before reading them:
`assets <same-root> --kind raster` for an illustration, `--name <regex>` when the design names
it, `--exportable` to drop what cannot be taken today. Ask for `--occurrences <identity>` only
when two records are genuinely ambiguous — that is the expensive half of this command, and on
a whole section it is thousands of chains. A thumbnail override, its replaced component
default and a banner are separate records: select the thumbnail's complete hash with
`export <same-root> --asset <hash>`. Do not export all references to obtain one illustration.
For a vector, use the inventory's `svg <source-id>` command; source colors, size and geometry
do not automatically incorporate the instance's overrides.

Use `--out` when the implementation needs a project-local destination. Extract assets from
the local `.fig` without requesting a separate asset export or switching to Figma MCP.
If `svg` rejects an unsupported appearance, ask the designer to flatten or outline that
vector and re-export the `.fig`; do not recreate the artwork manually.

`spec` and `inspect` read cached structure even when the original `.fig` is unavailable;
`assets`, `export` and `svg` need the source. The `assets` hint survives `spec --max-lines`.
Nested symbol choices show their property (or unknown defID), full guidPath, contextual
component name and symbol ID. `inspect` shows all overrides; `spec` limits ordinary overrides
and provides an explicit follow-up, while retaining symbol choices on each uncollapsed row.
`--symbols direct` expands base references and explicit choices on the requested subtree;
`all` also follows those references inside component bodies; `none` omits bodies but keeps
choices. These bodies describe source components, not the resolved appearance of an instance.
Use `assets` to check replacement targets and uncertainty; an absent target or property
definition proves neither a default choice nor an external-library origin.

## Reading a node properly

- **`spec` replaces the inspect/tree/texts loop** for anything with children. An INSTANCE has
  zero children — its content lives on the component, and `spec` already follows and prints
  each component once, so don't walk symbols by hand.
- **Batch everything.** Several nodes per invocation (`spec A B C`), chain decode+query with
  `&&`, and combine follow-ups (`texts X` and `raw Y --fields z`) into one shell command —
  each separate invocation costs a round-trip. Truncation messages state real totals; trust
  them instead of re-running speculatively. Never `cat` `nodes.jsonl` — it is ~100 MB.
- **Tokens beat literals.** Bound variables resolve to names inline — `gap=24
  [generico/24-32-32]`, `r=8 [radius/corner-fixed-8]`. Map those to code tokens; hardcoding
  `16px` throws away the design system link.
- **Copy hides in three places** — TEXT nodes, component properties (button labels), and
  instance *overrides* (per-row copy set deep inside a component). `spec` and `texts` surface
  all three; `texts` tags the origin (`[label]`, `[override]`).
- **Property names are defined per component — never assume a fixed set.** One button exposes
  `label`, `iconLeft`; another `text`, `size`, `state`. `inspect` prints whatever the component
  defines and ends with the node's remaining raw fields for `raw --fields`.
- **If a name comes out as `<def 8099:1234>`**, its definition could not be resolved in the
  cache; this alone does not prove an external-library origin. Read the **value** instead
  (`raw --fields componentPropAssignments`), or identify the property from the component via
  `find` on the name shown on the instance's `→ «Component»` reference.
- **Only overridden properties appear.** A property left at its component default is absent
  from the instance, so "missing" does not mean "false" or "empty".
- **Variants live in the component name**, e.g. `«Searchbar_XS: type=standart, state=pressed»`.

## Notes

- Requires Node ≥ **22.15** (or ≥ 23.8) for `zstdDecompressSync`, Python 3, and the `unzip` CLI
  (`decode.mjs` shells out to it to pull `canvas.fig` and `meta.json` out of the archive).
  `query.py` is standard library only; `decode.mjs` needs one npm package, `kiwi-schema`
  **≥ 0.5** — older releases reject Figma's current schema with `Invalid type -8`.
- That package is installed automatically on first decode into `~/.cache/figma-read/deps`,
  **not** into the skill folder — so a plugin update never wipes it. Nothing else to set up.
- `originFileKey` inside a `.fig` is a *library* key (`lk-…`), **not** the key in a figma.com
  URL. That is why `--url` exists.
- The cache is three files: `index.json` (id → name, type, parent, byte offset), `lookup.json`
  (`propDefs`, `propDefParent`, `variablesByGuid`, `variablesByKey`, `symbols`) and `nodes.jsonl`
  (one node per line). Reading commands use these files; `svg` re-decodes geometry from the
  original `.fig`. A question the reading subcommands don't
  cover can be answered by reading the two JSON files directly — never `nodes.jsonl`.
- A `.fig` is a snapshot. If a designer has changed the design since, re-export and `--force`.
- Decode leaves `images/` in the archive; `export` extracts only referenced image entries.
- **Keep the `.fig` out of git** — they run to hundreds of MB. The cache needs no `.gitignore`
  entry: it lives in `$TMPDIR`, not in the project.
- `~/.cache/figma-read/` holds only small, persistent state that must *not* expire on the
  `$TMPDIR` cycle: `config.json` (the preference above), `registry.json` (where each decoded
  design is, and the `.fig` path auto-recovery re-decodes from) and `deps/`.
- Decoding writes to a staging directory and renames it into place, so a concurrent reader or a
  second decode of the same `.fig` sees a complete cache, never a half-written one.
- `$TMPDIR` is purged per *file*, so a cache can lose one piece and still look present. Every
  query refreshes all three files' access times together to prevent that, and an incomplete or
  missing cache is rebuilt automatically from the `.fig` recorded in the registry (opt out with
  `--no-decode` / `FIGMA_READ_NO_AUTODECODE`).
- **Padding is not stored symmetrically.** Left and top live in `stackHorizontalPadding` /
  `stackVerticalPadding`; right and bottom have their own keys. There is no `stackPaddingLeft`
  or `stackPaddingTop`. `spec` and `inspect` print all four resolved (`pad=t,r,b,l`), so read
  them there rather than from `raw`.
- A variable can hold a different value per mode (light/dark, density...). `inspect` shows the
  first and says `(first of N modes)` when there are several — treat a colour token's literal
  value as indicative, and prefer the token name.
