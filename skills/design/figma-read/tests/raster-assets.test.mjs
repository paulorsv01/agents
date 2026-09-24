import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { loadKiwi } from '../scripts/fig-source.mjs';
import { createImageCollector } from '../scripts/raster-assets.mjs';

const guid = localID => ({sessionID:1, localID});
const hash = byte => new Uint8Array(20).fill(byte);
const paint = byte => ({type:'IMAGE', image:{hash:hash(byte), name:'illustration'}});
const node = (id, extra = {}) => ({guid:guid(id), name:`node ${id}`, type:'RECTANGLE', ...extra});
const nodes = [
  node(1, {type:'FRAME'}),
  node(2, {type:'INSTANCE', parentIndex:{guid:guid(1)}, symbolData:{symbolID:guid(3), symbolOverrides:[
    {guidPath:{guids:[guid(4)]}, fillPaints:[paint(2)]},
  ]}}),
  node(3, {type:'SYMBOL'}),
  node(4, {parentIndex:{guid:guid(3)}, fillPaints:[paint(1)]}),
  node(5, {parentIndex:{guid:guid(1)}, visible:false, fillPaints:[paint(2)]}),
  node(6),
];

test('collects subtree, hidden references, component defaults and overrides, deduplicated with origins', () => {
  const result = createImageCollector({nodeChanges:nodes})('1:1');
  assert.deepEqual(result.errors, []);
  assert.equal(result.assets.length, 2);
  const overridden = result.assets.find(a => a.hash === Buffer.from(hash(2)).toString('hex'));
  assert.deepEqual(overridden.sources.map(s=>s.node), ['1:2', '1:5']);
  assert.deepEqual(overridden.sources[0].path, ['1:4']);
  assert.equal(overridden.sources[0].kind, 'override');
  assert.equal(result.assets.find(a=>a !== overridden).sources[0].node, '1:4');
});

test('cycles terminate; absent components warn while local overrides remain available', () => {
  const cycle = node(7, {symbolData:{symbolID:guid(7), symbolOverrides:[{fillPaints:[paint(1)]}]}});
  assert.equal(createImageCollector({nodeChanges:[cycle]})('1:7').assets.length, 1);
  cycle.symbolData.symbolID = guid(999);
  const result = createImageCollector({nodeChanges:[cycle]})('1:7');
  assert.equal(result.assets.length, 1);
  assert.match(result.warnings[0], /Component 1:999 is absent/);
});

test('empty, absent and invalid image references produce actionable errors', () => {
  const collect = createImageCollector({nodeChanges:[...nodes, node(8, {fillPaints:[{type:'IMAGE', image:{hash:[256]}}]})]});
  assert.match(collect('1:6').errors[0], /No image references/);
  assert.match(collect('1:8').errors[0], /valid 20-byte image hash/);
  assert.throws(()=>collect('1:999'), /absent/);
});

for (const mode of [['--all-references']]) test(`offline raster CLI ${mode.join(' ') || 'legacy'} preserves ZIP bytes, deduplicates batch, reports sources and partial failures`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-raster-test-'));
  try {
    const kiwi = loadKiwi();
    const schema = kiwi.parseSchema(`
      message Guid { uint sessionID = 1; uint localID = 2; }
      message Parent { Guid guid = 1; }
      message GuidPath { Guid[] guids = 1; }
      message Image { byte[] hash = 1; string name = 2; }
      message Paint { string type = 1; Image image = 2; }
      message Override { GuidPath guidPath = 1; Paint[] fillPaints = 2; }
      message Symbol { Guid symbolID = 1; Override[] symbolOverrides = 2; }
      message Node { Guid guid = 1; string name = 2; string type = 3; Parent parentIndex = 4; Paint[] fillPaints = 5; Symbol symbolData = 6; bool visible = 7; }
      message Message { Node[] nodeChanges = 1; }
    `);
    const extras = [node(8, {fillPaints:[paint(3)]}), node(9, {fillPaints:[paint(4)]}), node(10, {fillPaints:[paint(5)]})];
    const chunks = [kiwi.encodeBinarySchema(schema), kiwi.compileSchema(schema).encodeMessage({nodeChanges:[...nodes, ...extras]})].map(b=>deflateRawSync(b));
    const header = Buffer.alloc(12); header.write('fig-kiwi'); header.writeUInt32LE(1,8);
    const parts = [header];
    for (const chunk of chunks) {
      const length = Buffer.alloc(4); length.writeUInt32LE(chunk.length);
      parts.push(length,chunk);
    }
    writeFileSync(join(dir,'canvas.fig'),Buffer.concat(parts));
    writeFileSync(join(dir,'meta.json'),'{}');
    mkdirSync(join(dir,'images'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64');
    const jpeg = Buffer.from([255,216,255,224,0,2,255,217]);
    const unknown = Buffer.from('unknown file format');
    for (const [byte, data] of [[1,png],[2,jpeg],[4,unknown],[5,Buffer.alloc(0)]]) {
      writeFileSync(join(dir,'images',Buffer.from(hash(byte)).toString('hex')),data);
    }
    writeFileSync(join(dir,'thumbnail.png'),png);
    const fig = join(dir,'synthetic.fig');
    assert.equal(spawnSync('zip',['-qr',fig,'canvas.fig','meta.json','images','thumbnail.png'],{cwd:dir}).status,0);
    const scripts = fileURLToPath(new URL('../scripts/',import.meta.url));
    const cache = join(dir,'cache');
    const env = {...process.env, FIGMA_READ_REGISTRY:join(dir,'registry.json'), TMPDIR:dir};
    const decoded = spawnSync(process.execPath,[join(scripts,'decode.mjs'),fig,'--out',cache],{env,encoding:'utf8'});
    assert.equal(decoded.status,0,decoded.stderr);
    const query = (...args) => spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'--dir',cache,'export',...mode,...args],{env,encoding:'utf8'});
    const out = join(dir,'assets');
    const result = query('1-1','1:2','--out',out);
    assert.equal(result.status,0,result.stderr);
    assert.equal(readdirSync(out).length,2);
    assert.deepEqual(readFileSync(join(out,`${Buffer.from(hash(1)).toString('hex')}.png`)),png);
    assert.deepEqual(readFileSync(join(out,`${Buffer.from(hash(2)).toString('hex')}.jpg`)),jpeg);
    assert.match(result.stdout,/1:2 \(node 2\) override 1:4/);
    assert.match(result.stdout,/1:4 \(node 4\) fill/);
    const partial = query('1:1','1:6','1:8','1:10','1:999','--out',out);
    assert.equal(partial.status,1);
    assert.match(partial.stdout,/\.png/);
    assert.match(partial.stderr,/No image references/);
    assert.match(partial.stderr,/missing, empty or unreadable/);
    assert.match(partial.stderr,/absent/);
    const fallback = query('1:9');
    assert.equal(fallback.status,0,fallback.stderr);
    assert.match(fallback.stdout,/figma-read\/assets\/.*\.bin/);
    assert.match(fallback.stderr,/unknown image format/);
    const blocked = join(dir,'file');
    writeFileSync(blocked,'not a directory');
    assert.equal(query('1:1','--out',blocked).status,1);
    rmSync(fig);
    assert.match(query('1:1').stderr,/original .fig/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
