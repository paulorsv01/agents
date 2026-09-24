import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
// Imported as a namespace on purpose: `zstdDecompressSync` only exists from Node
// 22.15 / 23.8, and a *named* ESM import of a missing export fails at module load
// with an opaque error before any of our code can explain why.
import * as zlib from 'zlib';
import { createRequire } from 'module';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..');

// kiwi-schema >= 0.5 is required: earlier releases reject Figma's current
// schema with "Invalid type -8".
const KIWI_DEP = 'kiwi-schema@^0.5.0';

// Dependencies are installed into a user-level directory, NOT the skill folder.
// When this ships as a plugin the skill lives in a cache that is wiped on every
// plugin update, so installing there would mean reinstalling constantly — and
// may not be writable at all.
const DEPS_DIR = `${homedir()}/.cache/figma-read/deps`;

export function loadKiwi() {
  // A local node_modules (dev checkout) wins; otherwise use the shared deps dir.
  for (const base of [SKILL_ROOT, DEPS_DIR]) {
    try {
      return createRequire(`${base}/noop.js`)('kiwi-schema');
    } catch {}
  }
  console.error(`installing ${KIWI_DEP} into ${DEPS_DIR} (one time)...`);
  mkdirSync(DEPS_DIR, { recursive: true });
  if (!existsSync(`${DEPS_DIR}/package.json`)) {
    writeFileSync(`${DEPS_DIR}/package.json`, JSON.stringify({ name: 'figma-read-deps', private: true }) + '\n');
  }
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', KIWI_DEP], {
    cwd: DEPS_DIR,
    stdio: 'inherit',
  });
  return createRequire(`${DEPS_DIR}/noop.js`)('kiwi-schema');
}


export function decodeFig(figPath) {
  const canvas = execFileSync('unzip', ['-p', figPath, 'canvas.fig'], { maxBuffer: 1 << 30 });
  if (canvas.length < 12 || canvas.subarray(0, 8).toString() !== 'fig-kiwi') {
    throw new Error('canvas.fig is not a fig-kiwi container; supply a local .fig export.');
  }
  const figKiwiVersion = canvas.readUInt32LE(8);

  const chunks = [];
  for (let off = 12; off + 4 <= canvas.length; ) {
    const len = canvas.readUInt32LE(off);
    off += 4;
    if (len > canvas.length - off) throw new Error('Truncated canvas.fig chunk; re-export the .fig.');
    chunks.push(canvas.subarray(off, off + len));
    off += len;
  }
  if (chunks.length < 2) {
    throw new Error(`Expected >=2 chunks in canvas.fig, got ${chunks.length}; re-export the .fig.`);
  }

  // Sniff per chunk: the schema is raw deflate, the payload is zstd on current
  // exports. Sniffing keeps this working if either side flips format.
  const isZstd = (b) => b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
  const decompress = (b) => {
    if (!isZstd(b)) return zlib.inflateRawSync(b);
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new Error(`This .fig uses zstd: upgrade Node ${process.version} to >= 22.15 (or >= 23.8).`);
    }
    return zlib.zstdDecompressSync(b);
  };

  const kiwi = loadKiwi();
  const schema = kiwi.compileSchema(kiwi.decodeBinarySchema(decompress(chunks[0])));
  const decoded = schema.decodeMessage(new Uint8Array(decompress(chunks[1])));

  return { decoded, figKiwiVersion };
}
