import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { loadKiwi } from '../scripts/fig-source.mjs';
import { contextFixture } from './fixtures/asset-context.mjs';

function archive(dir, decoded = contextFixture().decoded) {
  const kiwi=loadKiwi();
  const schema=kiwi.parseSchema(`
    message Guid { uint sessionID = 1; uint localID = 2; }
    message Parent { Guid guid = 1; }
    message Path { Guid[] guids = 1; }
    message Image { byte[] hash = 1; string name = 2; }
    message Color { float r = 1; float g = 2; float b = 3; float a = 4; }
    message Paint { string type = 1; Image image = 2; bool visible = 3; uint originalImageWidth = 4; uint originalImageHeight = 5; Color color = 6; }
    message SymbolValue { Guid guid = 1; }
    message Value { SymbolValue symbolIdValue = 1; }
    message Variable { Value value = 1; string dataType = 2; string resolvedDataType = 3; }
    message Assignment { Guid defID = 1; Variable varValue = 2; }
    message Override { Path guidPath = 1; Paint[] fillPaints = 2; Assignment[] componentPropAssignments = 3; Symbol symbolData = 4; }
    message Symbol { Guid symbolID = 1; Override[] symbolOverrides = 2; }
    message Size { float x = 1; float y = 2; }
    message VectorData { uint vectorNetworkBlob = 1; Size normalizedSize = 2; }
    message Blob { byte[] bytes = 1; }
    message Node { Guid guid = 1; string name = 2; string type = 3; Parent parentIndex = 4; Paint[] fillPaints = 5; Symbol symbolData = 6; bool visible = 7; Guid overrideKey = 8; Assignment[] componentPropAssignments = 9; Size size = 10; VectorData vectorData = 11; }
    message Message { Node[] nodeChanges = 1; Blob[] blobs = 2; }
  `);
  const chunks=[kiwi.encodeBinarySchema(schema),kiwi.compileSchema(schema).encodeMessage(decoded)].map(b=>deflateRawSync(b));
  const header=Buffer.alloc(12); header.write('fig-kiwi'); header.writeUInt32LE(1,8);
  const parts=[header];
  for (const chunk of chunks) {
    const size=Buffer.alloc(4); size.writeUInt32LE(chunk.length); parts.push(size,chunk);
  }
  writeFileSync(join(dir,'canvas.fig'),Buffer.concat(parts));
  writeFileSync(join(dir,'meta.json'),'{}');
  const fig=join(dir,'test.fig');
  assert.equal(spawnSync('zip',['-q',fig,'canvas.fig','meta.json'],{cwd:dir}).status,0);
  return fig;
}

test('assets CLI groups decode, scopes URLs, preserves partial results and never extracts images or writes assets', () => {
  const dir=mkdtempSync(join(tmpdir(),'figma-assets-cli-'));
  try {
    const fig=archive(dir), cache=join(dir,'cache');
    const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
    const env={...process.env,FIGMA_READ_REGISTRY:join(dir,'registry.json'),TMPDIR:dir};
    const decoded=spawnSync(process.execPath,[join(scripts,'decode.mjs'),fig,'--out',cache,'--url','https://www.figma.com/design/AAAAAAAAAAAA'],{env,encoding:'utf8'});
    assert.equal(decoded.status,0,decoded.stderr);
    const bin=join(dir,'bin'); mkdirSync(bin);
    writeFileSync(join(bin,'unzip'),'#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$ASSET_UNZIP_LOG"\nexec /usr/bin/unzip "$@"\n');
    chmodSync(join(bin,'unzip'),0o755);
    env.PATH=`${bin}:${env.PATH}`; env.ASSET_UNZIP_LOG=join(dir,'unzip.log');
    writeFileSync(env.ASSET_UNZIP_LOG,'');
    spawnSync(process.env.PYTHON || 'python3',['-c','pass'],{env});
    const before=readdirSync(dir,{recursive:true}).sort();
    const query=(...args)=>spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'assets',...args],{env,encoding:'utf8'});
    const result=query('https://www.figma.com/design/AAAAAAAAAAAA/design?node-id=41-1','41:52','--json');
    assert.equal(result.status,0,result.stderr);
    const inventory=JSON.parse(result.stdout);
    assert.equal(inventory.version,2);
    assert.equal(inventory.document.fileKey,'AAAAAAAAAAAA');
    assert.deepEqual(inventory.roots.map(r=>r.root),['41:1','41:52']);
    assert.equal(inventory.roots[0].counts.rasters,5);
    assert.equal(inventory.roots[1].assets.some(r=>r.sourceNode==='41:121'),true);
    assert.equal(inventory.roots[0].assets.some(r=>r.occurrences),false);
    const calls=readFileSync(env.ASSET_UNZIP_LOG,'utf8');
    assert.equal(calls.split('\n').filter(l=>l.includes('canvas.fig')).length,1);
    assert.equal(calls.includes('images/'),false);
    assert.deepEqual(readdirSync(dir,{recursive:true}).sort(),before);
    const implicit=spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'export','41:1','--dir',cache],{env,encoding:'utf8'});
    assert.equal(implicit.status,2,implicit.stderr);
    assert.match(implicit.stdout,/export 41:1 --asset/);
    assert.equal(readFileSync(env.ASSET_UNZIP_LOG,'utf8').includes('images/'),false);
    assert.deepEqual(readdirSync(dir,{recursive:true}).sort(),before);
    const plain=query('41-2','--dir',cache);
    assert.equal(plain.status,0,plain.stderr);
    assert.match(plain.stdout,/overridden/);
    assert.doesNotMatch(plain.stdout,/paint metadata/);
    const evidence=query('41-2','--dir',cache,'--occurrences','0101010101010101010101010101010101010101');
    assert.equal(evidence.status,0,evidence.stderr);
    assert.match(evidence.stdout,/paint metadata/);
    assert.notEqual(query('41-2','--dir',cache,'--occurrences','deadbeef').status,0);
    assert.notEqual(query('41-2','--dir',cache,'--occurrences','41:11','--kind','raster').status,0);
    const partial=query('41:2','41:9999','--dir',cache,'--json');
    assert.equal(partial.status,1);
    assert.equal(JSON.parse(partial.stdout).roots[0].counts.rasters,2);
    assert.match(partial.stderr,/absent/);
    for(const args of [
      ['https://www.figma.com/design/AAAAAAAAAAAA/design?node-id=41-1','https://www.figma.com/design/BBBBBBBBBBBB/design?node-id=41-1'],
      ['https://www.figma.com/design/BBBBBBBBBBBB/design?node-id=41-1','--dir',cache],
      ['invalid','--dir',cache],
      ['https://www.figma.com/design/AAAAAAAAAAAA','--dir',cache],
    ]) {
      writeFileSync(env.ASSET_UNZIP_LOG,'');
      const rejected=query(...args);
      assert.notEqual(rejected.status,0);
      assert.equal(readFileSync(env.ASSET_UNZIP_LOG,'utf8'),'');
    }
    rmSync(fig);
    assert.match(query('41:1','--dir',cache).stderr,/original .fig/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


test('exact raster selection validates the whole context before writing and preserves selected ZIP bytes', () => {
  const dir=mkdtempSync(join(tmpdir(),'figma-exact-'));
  try {
    const fixture=contextFixture(87,200,true), {id,hash}=fixture;
    const rootNodes=fixture.decoded.nodeChanges.filter(n=>[1,2,4,10,11].includes(n.guid.localID-200));
    const decoded={nodeChanges:rootNodes};
    const fig=archive(dir,decoded), cache=join(dir,'cache'), scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
    mkdirSync(join(dir,'images'));
    const bytes=new Map([1,2,4,5,8].map(n=>[hash(n),Buffer.from([137,80,78,71,13,10,26,10,n])]));
    for(const [value,data] of bytes) writeFileSync(join(dir,'images',value),data);
    assert.equal(spawnSync('zip',['-qr',fig,'images'],{cwd:dir}).status,0);
    const env={...process.env,FIGMA_READ_REGISTRY:join(dir,'registry.json'),TMPDIR:dir};
    assert.equal(spawnSync(process.execPath,[join(scripts,'decode.mjs'),fig,'--out',cache,'--url','https://www.figma.com/design/CCCCCCCCCCCC'],{env}).status,0);
    const query=(command,...args)=>spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'--dir',cache,command,...args],{env,encoding:'utf8'});
    const inventory=JSON.parse(query('assets',id(1),'--json').stdout).roots[0];
    assert.equal(inventory.counts.rasters,3);
    const selector=inventory.assets.find(r=>r.hash===hash(2)).selector;
    let sequence=0;
    const run=(...args)=>{
      const out=join(dir,`out-${sequence++}`);
      return {out,result:query('export',...args,'--out',out)};
    };
    for(const selectors of [[selector],[hash(1),selector],[selector,selector]]) {
      const {out,result}=run(id(1),...selectors.flatMap(value=>['--asset',value]));
      assert.equal(result.status,0,result.stderr);
      assert.deepEqual(readdirSync(out).sort(),[...new Set(selectors)].map(v=>`${v}.png`).sort());
      for(const value of selectors) assert.deepEqual(readFileSync(join(out,`${value}.png`)),bytes.get(value));
    }
    for(const args of [
      [id(1),'--asset',hash(2),'--asset',hash(8)],
      [id(1),'--asset',hash(9)],
      [id(1),'--asset','../../images/file'],
      [id(1),'--asset',hash(2).slice(0,39)],
      [id(1),id(2),'--asset',hash(2)],
      [id(1),'--asset',hash(2),'--all-references'],
      ['https://www.figma.com/design/DDDDDDDDDDDD/design?node-id=87-201','--asset',hash(2)],
      [id(999),'--asset',hash(2)],
    ]) {
      const {out,result}=run(...args);
      assert.notEqual(result.status,0,result.stdout);
      assert.equal(existsSync(out),false,result.stderr);
    }
    const broad=run(id(1),'--all-references');
    assert.equal(broad.result.status,0,broad.result.stderr);
    assert.equal(readdirSync(broad.out).length,3);
    assert.doesNotMatch(broad.result.stderr,/deprecated/);
    const legacy=run(id(1));
    assert.equal(legacy.result.status,2,legacy.result.stderr);
    assert.match(legacy.result.stdout,/--asset/);
    assert.equal(existsSync(legacy.out),false);
    const single=run(id(4));
    assert.equal(single.result.status,2,single.result.stderr);
    assert.equal(existsSync(single.out),false);
    rmSync(join(dir,'images',hash(4)));
    assert.equal(spawnSync('zip',['-dq',fig,`images/${hash(4)}`],{cwd:dir}).status,0);
    const partial=run(id(1),'--asset',hash(2),'--asset',hash(4));
    assert.equal(partial.result.status,1);
    assert.deepEqual(readdirSync(partial.out),[`${hash(2)}.png`]);
    decoded.nodeChanges.find(n=>n.guid.localID===202).symbolData.symbolOverrides[0].fillPaints=[];
    archive(dir,decoded);
    const stale=run(id(1),'--asset',hash(1),'--asset',hash(2));
    assert.equal(stale.result.status,1);
    assert.match(stale.result.stderr,/not referenced/);
    assert.equal(existsSync(stale.out),false);
    archive(dir,fixture.decoded);
    for(const source of [id(60),id(61)]) {
      const swapped=run(source,'--asset',hash(5));
      assert.equal(swapped.result.status,0,swapped.result.stderr);
      assert.deepEqual(readdirSync(swapped.out),[`${hash(5)}.png`]);
      assert.deepEqual(readFileSync(join(swapped.out,`${hash(5)}.png`)),bytes.get(hash(5)));
    }
    const hidden=run(id(5),'--asset',hash(2));
    assert.equal(hidden.result.status,0,hidden.result.stderr);
    assert.match(hidden.result.stdout,/hidden/);
    assert.deepEqual(readdirSync(hidden.out),[`${hash(2)}.png`]);
    rmSync(fig);
    const absent=run(id(1),'--asset',hash(1));
    assert.equal(absent.result.status,1);
    assert.match(absent.result.stderr,/original .fig/);
    assert.equal(existsSync(absent.out),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});


// A 10x10 triangle: the smallest vector network the exporter accepts, so a
// synthetic .fig can exercise exportable candidates instead of only errors.
function triangle() {
  const b=Buffer.alloc(156); let o=0;
  const u=v=>{b.writeUInt32LE(v,o);o+=4;}, f=v=>{b.writeFloatLE(v,o);o+=4;};
  u(3);u(3);u(1);
  for(const [x,y] of [[0,0],[10,0],[0,10]]) {u(0);f(x);f(y);}
  for(const [start,end] of [[0,1],[1,2],[2,0]]) {u(0);u(start);f(0);f(0);u(end);f(0);f(0);}
  u(1);u(1);u(3);u(0);u(1);u(2);
  return new Uint8Array(b);
}

function geometry(instances) {
  const g=localID=>({sessionID:70,localID});
  const solid=(r,gr,bl)=>({type:'SOLID',color:{r,g:gr,b:bl,a:1}});
  const vector=(localID,parent,paint)=>({guid:g(localID),name:`shape ${localID}`,type:'VECTOR',
    parentIndex:{guid:g(parent)},size:{x:10,y:10},fillPaints:[paint],
    vectorData:{vectorNetworkBlob:0,normalizedSize:{x:10,y:10}}});
  const nodes=[
    {guid:g(1),name:'screen',type:'FRAME'},
    {guid:g(10),name:'star illustration',type:'SYMBOL',size:{x:24,y:24}},
    vector(11,10,solid(1,0,0)),
    {guid:g(20),name:'pair',type:'SYMBOL',size:{x:24,y:24}},
    vector(21,20,solid(0,0,1)),
    vector(22,20,solid(0,1,0)),
    {guid:g(30),name:'photo',type:'RECTANGLE',parentIndex:{guid:g(1)},
     fillPaints:[{type:'IMAGE',image:{hash:new Uint8Array(20).fill(7),name:'photo.png'},originalImageWidth:880,originalImageHeight:500}]},
    {guid:g(200),name:'pair here',type:'INSTANCE',parentIndex:{guid:g(1)},symbolData:{symbolID:g(20)}},
  ];
  for(let i=0;i<instances;i++) nodes.push({guid:g(100+i),name:`row ${i}`,type:'INSTANCE',parentIndex:{guid:g(1)},symbolData:{symbolID:g(10)}});
  return {nodeChanges:nodes,blobs:[{bytes:triangle()}]};
}

function decodedGeometry(dir, instances) {
  mkdirSync(dir,{recursive:true});
  const fig=archive(dir,geometry(instances)), cache=join(dir,'cache');
  const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
  const env={...process.env,FIGMA_READ_REGISTRY:join(dir,'registry.json'),TMPDIR:dir};
  assert.equal(spawnSync(process.execPath,[join(scripts,'decode.mjs'),fig,'--out',cache],{env,encoding:'utf8'}).status,0);
  return (...args)=>spawnSync(process.env.PYTHON || 'python3',[join(scripts,'query.py'),'--dir',cache,'assets',...args],{env,encoding:'utf8'});
}

test('the inventory costs one record per distinct asset, not one per occurrence', () => {
  const dir=mkdtempSync(join(tmpdir(),'figma-cost-'));
  try {
    const few=decodedGeometry(join(dir,'few'),3)('70:1');
    const many=decodedGeometry(join(dir,'many'),40)('70:1');
    assert.equal(few.status,0,few.stderr);
    assert.equal(many.status,0,many.stderr);
    // The property, not the format: 40 instances of one icon must read exactly
    // like 3 once the occurrence counts are removed.
    const shape=out=>out.split('\n').filter(l=>!l.startsWith('Document:')).join('\n').replace(/×\d+/g,'×N').replace(/\d+ occurrences/,'N occurrences');
    assert.equal(shape(many.stdout),shape(few.stdout));
    assert.match(few.stdout,/4 vectors \(4 exportable\), 7 occurrences/);
    assert.match(many.stdout,/4 vectors \(4 exportable\), 44 occurrences/);
    assert.equal(many.stdout.trimEnd().split('\n').length,11);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('identical SVG output collapses two candidates; a second vector keeps them apart', () => {
  const dir=mkdtempSync(join(tmpdir(),'figma-collapse-'));
  try {
    const query=decodedGeometry(dir,2);
    const roots=JSON.parse(query('70:1','--json').stdout).roots[0];
    const record=id=>roots.assets.find(r=>r.identity===id);
    assert.deepEqual(record('70:10').sameOutput,['70:11']);
    assert.equal(record('70:11'),undefined);
    // The pair SYMBOL exports both of its vectors, so it stays its own record
    // and only names the relation.
    assert.deepEqual(record('70:20').sameOutput,[]);
    assert.deepEqual(record('70:20').contains,['70:21','70:22']);
    assert.equal(record('70:21').inside,'70:20');
    assert.equal(roots.counts.vectors,4);
    const evidence=query('70:1','--occurrences','70:11');
    assert.equal(evidence.status,0,evidence.stderr);
    assert.match(evidence.stdout,/vector ×2 "shape 11"/);
    assert.match(query('70:1').stdout,/= 70:11/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('filters and limit answer the illustration question in a few records', () => {
  const dir=mkdtempSync(join(tmpdir(),'figma-filters-'));
  try {
    const query=decodedGeometry(dir,3);
    const lines=out=>out.split('\n').filter(l=>/^  (raster|vector) /.test(l));
    assert.deepEqual(lines(query('70:1','--kind','raster').stdout).length,1);
    assert.deepEqual(lines(query('70:1','--kind','vector').stdout).length,4);
    assert.deepEqual(lines(query('70:1','--exportable').stdout).length,5);
    const named=query('70:1','--name','star illustration');
    assert.deepEqual(lines(named.stdout).map(l=>l.includes('star illustration')),[true]);
    // find's loosening, reached through the same matcher
    const loose=query('70:1','--name','photo png');
    assert.match(loose.stdout,/showing matches for 'photo\[-_ \.\]\?png'/);
    assert.deepEqual(lines(loose.stdout).length,1);
    const cut=query('70:1','--limit','2');
    assert.deepEqual(lines(cut.stdout).length,2);
    assert.match(cut.stdout,/showing 2 of 5 records \(raise with --limit\)/);
    const json=JSON.parse(query('70:1','--kind','raster','--json').stdout).roots[0];
    assert.equal(json.assets.length,1);
    assert.equal(json.counts.vectors,4);
    assert.equal(json.matched,1);
    const capped=JSON.parse(query('70:1','--limit','2','--json').stdout).roots[0];
    assert.equal(capped.assets.length,2);
    assert.equal(capped.shown,2);
    assert.equal(capped.matched,5);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
