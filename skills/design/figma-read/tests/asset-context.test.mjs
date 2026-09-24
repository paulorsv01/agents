import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextFixture } from './fixtures/asset-context.mjs';
import { createAssetCollector } from '../scripts/asset-context.mjs';

for (const fixture of [contextFixture(),contextFixture(87,2000,true)]) {
  const {decoded,id,hash}=fixture;
  test(`context and uncertainty survive renamed/reidentified document ${id(1)}`, () => {
    const result=createAssetCollector(decoded)(id(1));
    assert.deepEqual(result.errors,[]);
    const file=n=>result.files.find(f=>f.hash===hash(n));
    assert.equal(file(1).occurrences.length,2);
    assert.ok(file(1).occurrences.every(o=>o.state==='overridden'));
    assert.deepEqual(file(1).occurrences.map(o=>o.instances),[[id(2)],[id(3)]]);
    assert.equal(file(2).occurrences.find(o=>o.origin==='override').state,'referenced');
    assert.equal(file(2).occurrences.find(o=>o.sourceNode===id(6)).state,'hidden');
    assert.equal(file(4).occurrences.length,2);
    assert.equal(file(4).occurrences.find(o=>o.sourceNode===id(7)).state,'hidden');
    assert.deepEqual(file(2).occurrences[0].paintDimensions,{width:73,height:29,source:'paint-metadata'});
    assert.ok(result.warnings.some(w=>w.includes(id(999))));
    assert.ok(result.warnings.some(w=>w.includes('Cycle')));
    for(let i=0;i<4;i++) {
      const candidate=result.vectors.find(v=>v.sourceNode===id(101+i*10));
      assert.ok(candidate);
      assert.equal(candidate.occurrences[0].instances[0],id(50+i));
      assert.equal(candidate.occurrences[0].selection.defID,id(800));
      assert.deepEqual(candidate.occurrences[0].selection.guidPath,i===0?[id(21)]:i===1?[id(21),id(31)]:[id(900+i)]);
      assert.equal(candidate.occurrences[0].selection.targetResolved,i<2);
      assert.equal(candidate.svg.supported,false);
      assert.equal(candidate.svg.command,`svg ${id(101+i*10)}`);
    }
    assert.ok(file(5).occurrences.some(o=>o.instances[0]===id(60)));
    assert.ok(file(5).occurrences.some(o=>o.instances[0]===id(61)));
    assert.ok(result.warnings.some(w=>w.includes(id(998))));
    assert.ok(result.warnings.some(w=>w.includes('not found') && w.includes(id(902))));
    assert.ok(!result.warnings.some(w=>w.includes('external library')));
  });
}

test('full guidPath and roots isolate occurrences; absent target does not suppress a present choice', () => {
  const {decoded,id}=contextFixture();
  const collect=createAssetCollector(decoded);
  assert.equal(collect(id(50)).vectors.some(v=>v.sourceNode===id(111)),false);
  assert.ok(collect(id(52)).vectors.some(v=>v.sourceNode===id(121)));
  const result=collect(id(61));
  const placeholder=result.vectors.find(v=>v.sourceNode===id(40));
  assert.ok(placeholder.occurrences.every(o=>o.state==='overridden'));
  const wrong=structuredClone(decoded);
  wrong.nodeChanges.find(n=>n.guid.localID===61).symbolData.symbolOverrides[0].guidPath.guids.reverse();
  const unresolved=createAssetCollector(wrong)(id(61));
  assert.equal(unresolved.vectors.find(v=>v.sourceNode===id(40)).occurrences[0].state,'unresolved');
  assert.equal(unresolved.files[0].occurrences[0].selection.targetResolved,false);
  assert.throws(()=>collect(id(1000)),/absent/);
});

test('property bindings prove replacement without relying on names; ambiguous slots remain unresolved', () => {
  for (const {decoded,id,hash} of [contextFixture(),contextFixture(90,500,true)]) {
    const g=localID=>({sessionID:Number(id(0).split(':')[0]),localID:Number(id(localID).split(':')[1])});
    const slot=decoded.nodeChanges.find(n=>n.guid.localID===g(21).localID);
    slot.componentPropRefs=[{defID:g(800),componentPropNodeField:'OVERRIDDEN_SYMBOL_ID'}];
    const collect=createAssetCollector(decoded);
    const result=collect(id(60));
    const selected=result.files.find(f=>f.hash===hash(5)).occurrences[0];
    assert.equal(selected.selection.replacementResolved,true);
    assert.equal(selected.selection.slot,id(21));
    assert.equal(selected.state,'referenced');
    assert.ok(selected.path.some(p=>p.id===id(21)));
    assert.equal(result.vectors.find(v=>v.sourceNode===id(40)).occurrences[0].state,'overridden');
    decoded.nodeChanges.push({...structuredClone(slot),guid:g(22)});
    const ambiguous=createAssetCollector(decoded)(id(60));
    assert.equal(ambiguous.files.find(f=>f.hash===hash(5)).occurrences[0].selection.replacementResolved,false);
    assert.ok(ambiguous.vectors.find(v=>v.sourceNode===id(40)).occurrences.every(o=>o.state==='unresolved'));
  }
});

test('paint replacement uses target evidence, including empty paints and source root aliases', () => {
  const {decoded,id,hash}=contextFixture();
  const n=localID=>decoded.nodeChanges.find(n=>n.guid.localID===localID);
  n(10).fillPaints=[{type:'IMAGE',image:{hash:new Uint8Array(20).fill(1)}}];
  n(2).fillPaints=[];
  let result=createAssetCollector(decoded)(id(2));
  assert.equal(result.files.find(f=>f.hash===hash(1)).occurrences.length,2);
  assert.ok(result.files.find(f=>f.hash===hash(1)).occurrences.every(o=>o.state==='overridden'));
  n(2).symbolData.symbolOverrides[0].fillPaints=n(11).fillPaints;
  result=createAssetCollector(decoded)(id(2));
  const sameHash=result.files.find(f=>f.hash===hash(1));
  assert.ok(sameHash.occurrences.some(o=>o.origin==='override' && o.state==='referenced'));
  n(10).publishID={sessionID:41,localID:111};
  result=createAssetCollector(decoded)(id(2));
  assert.equal(result.files.find(f=>f.hash===hash(1)).occurrences.find(o=>o.origin==='override').state,'unresolved');
  assert.equal(result.files.find(f=>f.hash===hash(1)).occurrences.find(o=>o.sourceNode===id(11)).state,'unresolved');
});

test('hidden ancestors, invalid hashes and empty nodes have explicit independent outcomes', () => {
  const {decoded,id}=contextFixture();
  const collect=createAssetCollector(decoded);
  assert.equal(collect(id(6)).files[0].occurrences[0].state,'hidden');
  assert.deepEqual(collect(id(70)).errors,[]);
  const empty=collect(id(100));
  assert.deepEqual(empty.files,[]);
  decoded.nodeChanges.find(n=>n.guid.localID===70).fillPaints[0].image.hash=[-1];
  assert.match(createAssetCollector(decoded)(id(70)).errors[0],/20-byte/);
});


test('nested property bindings retain the complete path and mark only that slot replaced', () => {
  const {decoded,id}=contextFixture();
  decoded.nodeChanges.find(n=>n.guid.localID===31).componentPropRefs=[{
    defID:{sessionID:41,localID:800},componentPropNodeField:'OVERRIDDEN_SYMBOL_ID',
  }];
  const result=createAssetCollector(decoded)(id(50));
  const selected=result.vectors.find(v=>v.sourceNode===id(101)).occurrences[0];
  assert.equal(selected.selection.replacementResolved,true);
  assert.equal(selected.selection.slot,id(31));
  assert.deepEqual(selected.selection.guidPath,[id(21)]);
  assert.deepEqual(selected.instances,[id(50),id(21),id(31)]);
  assert.equal(selected.state,'referenced');
  assert.equal(result.vectors.find(v=>v.sourceNode===id(40)).occurrences[0].state,'overridden');
});

test('the exported SVG decides whether a SYMBOL and its VECTOR are one asset', () => {
  const base = new URL('./fixtures/plus',import.meta.url).pathname;
  const data = {...JSON.parse(readFileSync(`${base}.json`)),blobs:[{bytes:readFileSync(`${base}.bin`)}]};
  const result = createAssetCollector(data)(data.parent);
  const digest = id => result.vectors.find(v=>v.sourceNode===id).svg.digest;
  // Same bytes: the SYMBOL is the vector's own enclosing frame, so viewBox and
  // placement coincide. This is what lets the inventory collapse the two.
  assert.equal(digest(data.parent),digest(data.id));
  assert.match(digest(data.id),/^[0-9a-f]{12}$/);
  const twin = structuredClone(data);
  const vector = twin.nodeChanges.find(n=>n.type==='VECTOR');
  twin.nodeChanges.push({...structuredClone(vector),guid:{sessionID:1,localID:9001}});
  twin.blobs = data.blobs;
  const two = createAssetCollector(twin)(twin.parent);
  const pick = id => two.vectors.find(v=>v.sourceNode===id).svg;
  // A SYMBOL holding two vectors exports both, so it is not the same asset as
  // either one — the relation gets labelled instead of collapsed.
  assert.notEqual(pick(twin.parent).digest,pick(twin.id).digest);
  assert.equal(pick(twin.id).digest,pick('1:9001').digest);
});
