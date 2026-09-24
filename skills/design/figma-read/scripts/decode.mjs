#!/usr/bin/env node
// decode.mjs — turn a locally-exported Figma .fig into a queryable cache.
//
//   node decode.mjs <file.fig> [--url <figma-url>] [--out <dir>] [--force] [--full]
//
// A .fig is a ZIP. The design lives in `canvas.fig`, a `fig-kiwi` container:
//   "fig-kiwi" (8B) + version u32 + repeated [u32 len + payload]
//     chunk 0 = raw-deflate Kiwi binary schema
//     chunk 1 = zstd        Kiwi-encoded scenegraph message
//
// Figma ships its own schema inside the file, so nothing is hardcoded against a
// Figma version and no network, auth or browser is involved. Only canvas.fig is
// unpacked — images/ is ~99% of the archive and is never touched.
//
// Emits, into <out>:
//   nodes.jsonl   one node per line
//   index.json    id -> [name, type, parentId, byteOffset, byteLength] + file metadata
//   lookup.json   component-prop-def names, variable/token names, symbol names
//   scenegraph.json  (only with --full; 100 MB+, rarely needed)
//
// The offset index is what keeps queries fast: inspecting one node seeks to a
// single line instead of parsing a 100 MB document.

import {
  writeFileSync, readFileSync, mkdirSync, existsSync, statSync,
  openSync, writeSync, closeSync, renameSync, rmSync,
} from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { dirname, basename, resolve } from 'path';
import { decodeFig } from './fig-source.mjs';

// --- args ---
const argv = process.argv.slice(2);
let figPath = null, outDir = null, force = false, full = false, urlKey = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const needsValue = (flag) => {
    const v = argv[++i];
    if (v === undefined) {
      console.error(`ERROR: ${flag} needs a value`);
      process.exit(1);
    }
    return v;
  };
  if (a === '--out') outDir = needsValue('--out');
  else if (a === '--force') force = true;
  else if (a === '--full') full = true;
  else if (a === '--url' || a === '--key') {
    // Tag the cache with the file key from the design's URL, so a teammate can
    // later pass any node URL and have it resolve to the right cache. Note the
    // in-file `originFileKey` is a *library* key (lk-...) and is NOT this.
    const v = needsValue(a);
    const m = v.match(/\/(?:design|file)\/([A-Za-z0-9]{10,})/);
    urlKey = m ? m[1] : v || null;
  } else if (a.startsWith('-')) {
    console.error(`ERROR: unknown flag: ${a}`);
    process.exit(1);
  } else if (!figPath) figPath = a;
  else {
    console.error(`ERROR: unexpected argument: ${a}`);
    process.exit(1);
  }
}
if (!figPath) {
  console.error('usage: decode.mjs <file.fig> [--url <figma-url>] [--out <dir>] [--force] [--full]');
  process.exit(1);
}
figPath = resolve(figPath.replace(/^~/, homedir()));
if (!existsSync(figPath)) {
  console.error(`ERROR: no such file: ${figPath}`);
  process.exit(1);
}

const gid = (g) => (g ? `${g.sessionID ?? 0}:${g.localID ?? 0}` : null);

// --- where to cache (derived from figPath alone, so it can gate the decode) ---
const slug = basename(figPath)
  .replace(/\.fig$/i, '')
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

// The decoded cache is ~100 MB of derived data, so it goes in the per-user
// temp dir rather than next to the .fig or under the project:
//   * nothing lands in a repo, so no .gitignore entry is needed
//   * macOS dirhelper purges $TMPDIR entries untouched for 3 days
//     (CLEAN_FILES_OLDER_THAN_DAYS=3), and it keys on *access* time — a design
//     in active use survives, a stale one cleans itself up
//   * losing it costs one re-decode, and `query.py` prunes dead registry rows
// The path is deterministic, not random: a random dir per run would leave a
// fresh 100 MB copy behind on every decode and never reuse anything. The hash
// of the absolute path keeps two same-named .fig files apart.
const TMP_ROOT = (process.env.TMPDIR || '/tmp').replace(/\/+$/, '');
const figHash = createHash('sha1').update(figPath).digest('hex').slice(0, 8);
if (!outDir) {
  outDir = `${TMP_ROOT}/figma-read/${slug}-${figHash}`;
}
outDir = resolve(outDir.replace(/^~/, homedir()));

// Small, persistent state lives in ~/.cache and deliberately does NOT follow the
// bulk into $TMPDIR: a user preference (config.json) that deleted itself after
// three idle days would be a bug, and re-downloading deps on that cycle is waste.
const REGISTRY = process.env.FIGMA_READ_REGISTRY || `${homedir()}/.cache/figma-read/registry.json`;

function updateRegistry(entry) {
  try {
    mkdirSync(dirname(REGISTRY), { recursive: true });
    let reg = [];
    if (existsSync(REGISTRY)) {
      try { reg = JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch {}
    }
    if (!Array.isArray(reg)) reg = [];
    reg = reg.filter((e) => e && e.dir !== entry.dir && existsSync(`${e.dir}/index.json`));
    // The cache dir is keyed by the .fig path, so the same design exported twice
    // (Downloads first, then the project) lives in two caches under one file key.
    // A query given a URL then has to choose; say here that the choice exists.
    const twins = entry.urlFileKey ? reg.filter((e) => e.urlFileKey === entry.urlFileKey) : [];
    for (const twin of twins) {
      console.error(`note: ${twin.dir} (${twin.figPath}) already holds file key ${entry.urlFileKey};`);
      console.error('      a query by URL picks the cache whose .fig is newest — pass --dir to force one.');
    }
    reg.push(entry);
    writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  } catch (e) {
    console.error(`warn: could not update registry — ${e.message}`);
  }
}

// --- skip the work entirely when the cache is current ---
// This gate sits *before* the unzip and the Kiwi decode: those are the expensive
// steps, and re-running them only to discard the result would defeat the cache.
if (!force && existsSync(`${outDir}/index.json`)) {
  if (statSync(`${outDir}/index.json`).mtimeMs >= statSync(figPath).mtimeMs) {
    // Still honour --url and re-register: a cache whose registry entry was lost
    // (new machine, fresh checkout, pruned entry) must be recoverable without a
    // full re-decode, and tagging a key should not require --force.
    let idx = {};
    try { idx = JSON.parse(readFileSync(`${outDir}/index.json`, 'utf8')); } catch {}
    const src = idx.source || {};
    if (urlKey && src.urlFileKey !== urlKey) {
      src.urlFileKey = urlKey;
      idx.source = src;
      try {
        writeFileSync(`${outDir}/index.json`, JSON.stringify(idx));
        console.error(`tagged existing cache with file key ${urlKey}`);
      } catch (e) {
        console.error(`warn: could not tag cache — ${e.message}`);
      }
    }
    updateRegistry({
      dir: outDir,
      fig: basename(figPath),
      figPath,
      figFileName: src.figFileName ?? null,
      urlFileKey: src.urlFileKey ?? urlKey ?? null,
    });
    console.error(`already decoded and up to date: ${outDir}`);
    console.error('(pass --force to redecode)');
    console.log(outDir);
    process.exit(0);
  }
}

// Carry a previously recorded file key across a re-decode: --force without --url
// should not silently untag a cache that was already resolvable by URL.
if (!urlKey) {
  try {
    urlKey = JSON.parse(readFileSync(`${outDir}/index.json`, 'utf8')).source?.urlFileKey ?? null;
    if (urlKey) console.error(`keeping existing file key ${urlKey}`);
  } catch {}
}

// --- unpack the container ---
let meta = {};
try {
  meta = JSON.parse(execFileSync('unzip', ['-p', figPath, 'meta.json']).toString());
} catch {
  console.error('warn: no meta.json in archive');
}

let decoded, figKiwiVersion;
try {
  ({ decoded, figKiwiVersion } = decodeFig(figPath));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
const nodes = decoded.nodeChanges ?? [];
const originFileKey = decoded.originFileKey ?? null;

// Write into a staging dir and rename into place at the end. A reader (or a
// second decode of the same .fig) then sees either the complete previous cache
// or the complete new one — never the torn half-written state that writing
// nodes.jsonl directly into outDir would expose for the whole decode.
const stageDir = `${outDir}.staging-${process.pid}`;
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Keep binary data out of the JSON cache; asset commands re-decode it on demand.
const replacer = (k, v) => {
  if (v instanceof Uint8Array) return `<binary ${v.length} bytes>`;
  if (typeof v === 'bigint') return Number(v);
  return v;
};

// --- write nodes.jsonl and build the offset index ---
const index = {};
const fd = openSync(`${stageDir}/nodes.jsonl`, 'w');
let offset = 0;
for (const n of nodes) {
  const id = gid(n.guid);
  if (!id) continue;
  const line = Buffer.from(JSON.stringify(n, replacer) + '\n');
  writeSync(fd, line);
  index[id] = [n.name ?? null, n.type ?? null, gid(n.parentIndex?.guid), offset, line.length - 1];
  offset += line.length;
}
closeSync(fd);

// --- lookup tables: prop-def names, variable/token names, symbol names ---
const propDefs = {};        // "sessionID:localID" -> property name (e.g. "label")
const propDefParent = {};   // variant-level ref id -> id of the def that carries the name
const variablesByGuid = {}; // guid -> {name, value}
const variablesByKey = {};  // library assetRef key -> {name, value, guid}
const symbols = {};         // symbol guid -> name (variant string, e.g. "size=large, state=enabled")

// A variable can resolve differently per mode (light/dark, density, ...). We
// record the first entry plus how many exist, so the reader can flag it rather
// than presenting one arbitrary mode as "the" value.
const firstValue = (v) => {
  const entries = v?.variableDataValues?.entries ?? [];
  const e = entries[0]?.variableData?.value;
  if (!e || typeof e !== 'object') return [null, entries.length];
  const k = Object.keys(e)[0];
  return [k ? e[k] : null, entries.length];
};

for (const n of nodes) {
  const id = gid(n.guid);
  // A component's own defs carry the human name ("label"); each variant repeats
  // them as unnamed entries pointing back via parentPropDefId. An instance's
  // assignment references the *variant* id, so both halves are needed.
  for (const d of [...(n.componentPropDefs ?? []), ...(n.componentPropRefs ?? [])]) {
    const did = gid(d.id);
    if (!did) continue;
    if (d.name) propDefs[did] = d.name;
    const parent = gid(d.parentPropDefId);
    if (parent && parent !== did) propDefParent[did] = parent;
  }
  if (n.type === 'VARIABLE') {
    const [value, modes] = firstValue(n);
    const rec = { name: n.name ?? null, value, modes, description: n.description ?? null };
    if (id) variablesByGuid[id] = rec;
    if (n.key) variablesByKey[n.key] = { ...rec, guid: id };
  }
  if (n.type === 'SYMBOL' && id) symbols[id] = n.name ?? null;
}

writeFileSync(
  `${stageDir}/lookup.json`,
  JSON.stringify({ propDefs, propDefParent, variablesByGuid, variablesByKey, symbols }),
);
writeFileSync(
  `${stageDir}/index.json`,
  JSON.stringify({
    source: {
      fig: basename(figPath),
      figPath,
      figFileName: meta.file_name ?? null,
      exportedAt: meta.exported_at ?? null,
      figKiwiVersion,
      originFileKey,   // a library key (lk-...), NOT the key in a figma.com URL
      urlFileKey: urlKey,
    },
    count: Object.keys(index).length,
    nodes: index,
  }),
);

if (full) {
  writeFileSync(`${stageDir}/scenegraph.json`, JSON.stringify(decoded, replacer));
}

// --- promote the staging dir atomically ---
try {
  const old = `${outDir}.old-${process.pid}`;
  mkdirSync(dirname(outDir), { recursive: true });
  const hadOld = existsSync(outDir);
  if (hadOld) renameSync(outDir, old);
  renameSync(stageDir, outDir);
  if (hadOld) rmSync(old, { recursive: true, force: true });
} catch (e) {
  rmSync(stageDir, { recursive: true, force: true });
  console.error(`ERROR: could not publish cache to ${outDir} — ${e.message}`);
  process.exit(1);
}

updateRegistry({
  dir: outDir,
  fig: basename(figPath),
  figPath,
  figFileName: meta.file_name ?? null,
  urlFileKey: urlKey,
});

console.error(
  `fig-kiwi v${figKiwiVersion} | ${Object.keys(index).length} nodes | ` +
    `${Object.keys(variablesByKey).length} variables | ${Object.keys(propDefs).length} prop defs`,
);
console.error(`file key: ${originFileKey ?? '(unknown)'}`);
console.error(`cache:    ${outDir}`);
console.log(outDir);
