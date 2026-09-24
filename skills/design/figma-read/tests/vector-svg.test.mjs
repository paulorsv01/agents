import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExporter, readNetwork, regionPaths } from '../scripts/vector-svg.mjs';

const fixture = name => {
  const base = new URL(`./fixtures/${name}`,import.meta.url);
  const data = JSON.parse(readFileSync(`${base.pathname}.json`));
  return {...data,blobs:[{bytes:readFileSync(`${base.pathname}.bin`)}]};
};
const vector = data => data.nodeChanges.find(n=>n.type==='VECTOR');

for (const name of ['plus','magnifyingGlass','dots','quarterNote']) {
  test(`${name}: exact path, frame padding, transform and design token`, () => {
    const data = fixture(name);
    const result = createExporter(data)(data.id);
    assert.equal(result.svg,readFileSync(new URL(`./fixtures/${name}.svg`,import.meta.url),'utf8'));
    assert.match(result.svg,/viewBox="0 0 24 24"/);
    assert.match(result.svg,/data-figma-token="base\/neutral\/foreground\/dynamic\/10"/);
  });
}

test('region rules preserve the magnifier hole and disconnected dots', () => {
  const lens = readNetwork(fixture('magnifyingGlass').blobs[0].bytes);
  assert.deepEqual(lens.regions.map(r=>[r.winding,r.loops.length]),[[0,2],[0,1]]);
  const dots = regionPaths(fixture('dots').blobs[0].bytes);
  assert.equal(dots.length,3);
  assert.ok(dots.every(p=>p.rule==='nonzero'));
  assert.deepEqual([...fixture('dots').blobs[0].bytes.subarray(0,12)],[12,0,0,0,12,0,0,0,3,0,0,0]);
});

test('complete affine transform applies to vertices and tangent endpoints', () => {
  const data = fixture('plus');
  const n = vector(data);
  n.transform = {m00:0,m01:-2,m02:40,m10:3,m11:0,m12:5};
  const {vertices,segments,regions} = readNetwork(data.blobs[0].bytes);
  const s = segments[regions[0].loops[0][0]], v = vertices[s.end];
  const point = (x,y) => `${Number((40-2*y).toFixed(6))} ${Number((5+3*x).toFixed(6))}`;
  const result = createExporter(data)(data.id).svg;
  assert.ok(result.includes(`M ${point(v.x,v.y)} C ${point(v.x+s.ex,v.y+s.ey)}`));
});

test('scales normalized geometry to the vector size before placement', () => {
  const data = fixture('magnifyingGlass');
  const n = vector(data);
  const result = createExporter(data)(data.id).svg;
  assert.match(result,/M 10\.542714 17\.276382/);
  n.size = {...n.vectorData.normalizedSize};
  assert.notEqual(createExporter(data)(data.id).svg,result);
});

test('SYMBOL ignores hidden construction subtrees and reports omitted container paint', () => {
  const data = fixture('plus');
  const exp = createExporter(data);
  const result = exp(data.parent);
  assert.equal(result.svg,exp(data.id).svg);
  assert.ok(result.warnings.some(w=>w.includes('container paint')));
});

test('multiple visible vectors are reported; multicolor cannot become currentColor', () => {
  const data = fixture('plus');
  const second = structuredClone(vector(data));
  second.guid = {sessionID:99,localID:1};
  second.fillPaints[0].color.r = 1;
  data.nodeChanges.push(second);
  const exp = createExporter(data);
  assert.ok(exp(data.parent).warnings.some(w=>w.includes('2 visible VECTOR')));
  assert.throws(()=>exp(data.parent,true),/monochrome/);
});

test('currentColor keeps opacity and token metadata', () => {
  const data = fixture('plus'), n = vector(data);
  n.opacity = 0.5; n.fillPaints[0].opacity = 0.5; n.fillPaints[0].color.a = 0.5;
  const svg = createExporter(data)(data.id,true).svg;
  assert.match(svg,/fill="currentColor" fill-opacity="0.125"/);
  assert.match(svg,/data-figma-token=/);
});

for (const type of ['ROUNDED_RECTANGLE','ELLIPSE','STAR','BOOLEAN_OPERATION','INSTANCE']) {
  test(`${type} gives an actionable error`, () => {
    const data = fixture('plus'); vector(data).type = type;
    assert.throws(()=>createExporter(data)(data.id),type==='INSTANCE' ? /source SYMBOL/ : /Flatten.*Figma/);
  });
}

test('stroke, absent blob, gradient, rounded corners and hidden vector are rejected', () => {
  for (const [mutate,message] of [
    [n=>n.strokePaints=[{type:'SOLID'}],/outline the stroke/],
    [n=>delete n.vectorData.vectorNetworkBlob,/no vectorNetworkBlob/],
    [n=>n.fillPaints[0].type='GRADIENT_LINEAR',/solid fill/],
    [n=>n.vectorData.styleOverrideTable[0].cornerRadius=2,/rounded corners/],
    [n=>n.visible=false,/hidden/],
  ]) {
    const data = fixture('plus'); mutate(vector(data));
    assert.throws(()=>createExporter(data)(data.id),message);
  }
});

test('invalid counts, truncation, indices and trailing bytes fail explicitly', () => {
  const blob = fixture('plus').blobs[0].bytes;
  assert.throws(()=>readNetwork(blob.subarray(0,10)),/Truncated/);
  assert.throws(()=>readNetwork(blob.subarray(0,blob.length-1)),/loop length/);
  assert.throws(()=>readNetwork(Buffer.concat([blob,Buffer.from([0])])),/trailing/);
  const bad = Buffer.from(blob); bad.writeUInt32LE(0xffffffff,12+16*12+4);
  assert.throws(()=>readNetwork(bad),/vertex index/);
});

test('reversed segments swap control points without changing loop geometry', () => {
  const bytes = Buffer.from(fixture('plus').blobs[0].bytes);
  const original = regionPaths(bytes);
  const offset = 12+bytes.readUInt32LE(0)*12+28*3;
  const start = Buffer.from(bytes.subarray(offset+4,offset+16));
  bytes.copy(bytes,offset+4,offset+16,offset+28);
  start.copy(bytes,offset+16);
  assert.deepEqual(regionPaths(bytes),original);
});
