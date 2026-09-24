import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateRawSync, zstdCompressSync } from 'node:zlib';
import { loadKiwi, decodeFig } from '../scripts/fig-source.mjs';

const scripts = fileURLToPath(new URL('../scripts/',import.meta.url));
const kiwi = loadKiwi();
const schema = kiwi.parseSchema(`
  message Guid { uint sessionID = 1; uint localID = 2; }
  message Parent { Guid guid = 1; string position = 2; }
  message Size { float x = 1; float y = 2; }
  message Transform { float m00 = 1; float m01 = 2; float m02 = 3; float m10 = 4; float m11 = 5; float m12 = 6; }
  message Color { float r = 1; float g = 2; float b = 3; float a = 4; }
  message Paint { string type = 1; Color color = 2; }
  message Vector { uint vectorNetworkBlob = 1; Size normalizedSize = 2; }
  message Node { Guid guid = 1; string name = 2; string type = 3; Parent parentIndex = 4; Size size = 5; Transform transform = 6; Vector vectorData = 7; Paint[] fillPaints = 8; bool visible = 9; }
  message Blob { byte[] bytes = 1; }
  message Message { Node[] nodeChanges = 1; Blob[] blobs = 2; string originFileKey = 3; }
`);

function makeFig(dir, compression) {
  const f = JSON.parse(readFileSync(new URL('./fixtures/plus.json',import.meta.url)));
  const raw = f.nodeChanges.filter(n=>n.type==='VECTOR' || `${n.guid.sessionID}:${n.guid.localID}`===f.parent);
  const fields = schema.definitions.find(d=>d.name==='Node').fields.map(f=>f.name);
  const nodes = raw.map(n=>Object.fromEntries(fields.filter(k=>k in n).map(k=>[k,n[k]])));
  nodes[0].fillPaints = [];
  const blob = readFileSync(new URL('./fixtures/plus.bin',import.meta.url));
  const message = kiwi.compileSchema(schema).encodeMessage({nodeChanges:nodes,blobs:[{bytes:blob}],originFileKey:'test-library'});
  const chunks = [deflateRawSync(kiwi.encodeBinarySchema(schema)),compression(message)];
  const header = Buffer.alloc(12); header.write('fig-kiwi'); header.writeUInt32LE(1,8);
  const bytes = [header];
  for (const chunk of chunks) {
    const length = Buffer.alloc(4); length.writeUInt32LE(chunk.length);
    bytes.push(length,chunk);
  }
  writeFileSync(join(dir,'canvas.fig'),Buffer.concat(bytes));
  writeFileSync(join(dir,'meta.json'),JSON.stringify({file_name:'Synthetic icon'}));
  const fig = join(dir,'synthetic.fig');
  const zip = spawnSync('zip',['-q',fig,'canvas.fig','meta.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(zip.status,0,zip.stderr);
  return fig;
}

for (const [name,compression] of [['deflate',deflateRawSync],['zstd',zstdCompressSync]]) {
  test(`offline CLI: ${name} decode, unchanged cache, SVG batch and errors`, () => {
    const dir = mkdtempSync(join(tmpdir(),'figma-read-test-'));
    try {
      const fig = makeFig(dir,compression);
      assert.equal(decodeFig(fig).decoded.blobs[0].bytes.length,728);
      const cache = join(dir,'cache'), registry = join(dir,'registry.json');
      const env = {...process.env,FIGMA_READ_REGISTRY:registry,TMPDIR:dir};
      const decode = (...args) => spawnSync(process.execPath,[join(scripts,'decode.mjs'),fig,'--out',cache,...args],{env,encoding:'utf8'});
      const first = decode('--key','syntheticKey123');
      assert.equal(first.status,0,first.stderr);
      assert.deepEqual(readdirSync(cache).sort(),['index.json','lookup.json','nodes.jsonl']);
      const idx = JSON.parse(readFileSync(join(cache,'index.json')));
      assert.equal(idx.count,2);
      assert.equal(idx.source.figPath,fig);
      assert.equal(idx.source.urlFileKey,'syntheticKey123');
      const lines = readFileSync(join(cache,'nodes.jsonl'));
      for (const [id,rec] of Object.entries(idx.nodes)) {
        const node = JSON.parse(lines.subarray(rec[3],rec[3]+rec[4]));
        assert.equal(`${node.guid.sessionID}:${node.guid.localID}`,id);
      }
      assert.match(decode().stderr,/already decoded/);
      assert.equal(decode('--force').status,0);
      assert.deepEqual(readFileSync(join(cache,'nodes.jsonl')),lines);
      assert.equal(JSON.parse(readFileSync(join(cache,'index.json'))).source.urlFileKey,'syntheticKey123');
      const query = (...args) => spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'--dir',cache,...args],{env,encoding:'utf8'});
      const out = join(dir,'svg');
      const result = query('svg','1-522','https://www.figma.com/design/syntheticKey123/test?node-id=1-517','--out',out,'--current-color');
      assert.equal(result.status,0,result.stderr);
      assert.equal(readdirSync(out).length,2);
      for (const file of readdirSync(out)) {
        const svg = readFileSync(join(out,file),'utf8');
        assert.match(svg,/viewBox="0 0 24 24"/);
        assert.match(svg,/fill="currentColor"/);
      }
      const defaultOut = query('svg','1:522');
      assert.equal(defaultOut.status,0,defaultOut.stderr);
      assert.match(defaultOut.stdout,/figma-read\/assets/);
      const partial = query('svg','1:522','999:999','--out',out);
      assert.equal(partial.status,1);
      assert.match(partial.stdout,/1:522/);
      assert.match(partial.stderr,/absent.*fresh cache/);
      const raw = query('raw','1:522','--fields','vectorData');
      assert.equal(raw.status,0,raw.stderr);
      assert.match(raw.stdout,/vectorNetworkBlob/);
      rmSync(fig);
      const missing = query('svg','1:522');
      assert.equal(missing.status,1);
      assert.match(missing.stderr,/original .fig/);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
}

test('corrupt .fig returns a useful decode error without a stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(),'figma-read-corrupt-'));
  try {
    makeFig(dir,deflateRawSync);
    writeFileSync(join(dir,'canvas.fig'),'fig-kiwi');
    rmSync(join(dir,'synthetic.fig'));
    spawnSync('zip',['-q','synthetic.fig','canvas.fig','meta.json'],{cwd:dir});
    const result = spawnSync(process.execPath,[join(scripts,'decode.mjs'),join(dir,'synthetic.fig'),'--out',join(dir,'cache')],{encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/ERROR:.*fig-kiwi container/);
    assert.doesNotMatch(result.stderr,/at decodeFig/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('two caches of one document: the newest .fig wins, out loud, and --dir overrides it', () => {
  const dir = mkdtempSync(join(tmpdir(),'figma-twins-'));
  try {
    const env = {...process.env,FIGMA_READ_REGISTRY:join(dir,'registry.json'),TMPDIR:dir};
    const url = 'https://www.figma.com/design/EEEEEEEEEEEE';
    const build = name => {
      const home = join(dir,name); mkdirSync(home);
      return {fig:makeFig(home,deflateRawSync),cache:join(home,'cache')};
    };
    const decode = ({fig,cache}) => spawnSync(process.execPath,[join(scripts,'decode.mjs'),fig,'--out',cache,'--url',url],{env,encoding:'utf8'});
    const older = build('older'), newer = build('newer');
    assert.equal(decode(older).status,0);
    const second = decode(newer);
    assert.equal(second.status,0);
    assert.match(second.stderr,new RegExp(`${older.cache} \\(${older.fig}\\) already holds file key EEEEEEEEEEEE`));
    const query = (...args) => spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'tree',`${url}/x?node-id=1-517`,...args],{env,encoding:'utf8'});
    utimesSync(older.fig,new Date(1e12),new Date(1e12));
    utimesSync(newer.fig,new Date(2e12),new Date(2e12));
    const picked = query();
    assert.equal(picked.status,0,picked.stderr);
    assert.match(picked.stderr,/2 caches share file key EEEEEEEEEEEE/);
    assert.match(picked.stderr,new RegExp(`using ${newer.cache} \\(${newer.fig}, newest .fig\\)`));
    assert.match(picked.stderr,new RegExp(`--dir "${older.cache}"`));
    // The .fig mtime decides, not registry order — which used to hand every
    // URL query to whichever copy was decoded first, without a word.
    utimesSync(older.fig,new Date(3e12),new Date(3e12));
    assert.match(query().stderr,new RegExp(`using ${older.cache}`));
    const forced = query('--dir',newer.cache);
    assert.equal(forced.status,0,forced.stderr);
    assert.doesNotMatch(forced.stderr,/caches share file key/);
    rmSync(older.cache,{recursive:true,force:true});
    const survivor = query();
    assert.equal(survivor.status,0,survivor.stderr);
    assert.doesNotMatch(survivor.stderr,/caches share file key/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
