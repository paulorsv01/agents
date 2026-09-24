import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contextFixture } from './fixtures/asset-context.mjs';

function cachedFixture(dir, renamed) {
  const fixture=contextFixture(87,200,renamed), {id}=fixture;
  const g=n=>({sessionID:87,localID:n+200});
  const rows=fixture.decoded.nodeChanges;
  for(let i=0;i<4;i++) {
    rows.find(n=>n.guid.localID===300+i*10).name=renamed ? '' : ['textEdit','trashCan','bookmark','plus'][i];
    const row=rows.find(n=>n.guid.localID===250+i);
    row.name='same row';
    row.symbolData.symbolOverrides.unshift(...Array.from({length:8},(_,j)=>({guidPath:{guids:[g(500+j)]},textData:{characters:`copy ${j}`}})));
    row.symbolData.symbolOverrides.push({guidPath:{guids:[g(21)]},visible:false,textData:{characters:'still readable'},componentPropAssignments:[
      {defID:g(801),varValue:{value:{boolValue:false}}},
      {defID:g(802),varValue:{value:{stringValue:'nested text'}}},
    ]});
  }
  const index={source:{figPath:join(dir,'missing.fig')},nodes:{}};
  let offset=0; const lines=[];
  for(const n of rows) {
    const line=JSON.stringify(n)+'\n', length=Buffer.byteLength(line);
    index.nodes[id(n.guid.localID-200)]=[n.name,n.type,n.parentIndex ? id(n.parentIndex.guid.localID-200) : null,offset,length];
    lines.push(line); offset+=length;
  }
  writeFileSync(join(dir,'index.json'),JSON.stringify(index));
  writeFileSync(join(dir,'lookup.json'),JSON.stringify({propDefs:{[id(800)]:'arbitrary icon property'}}));
  writeFileSync(join(dir,'nodes.jsonl'),lines.join(''));
  return fixture;
}

for(const renamed of [false,true]) test(`cached spec and inspect retain every contextual symbol choice; renamed=${renamed}`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'figma-spec-'));
  try {
    const {id}=cachedFixture(dir,renamed);
    const script=fileURLToPath(new URL('../scripts/query.py',import.meta.url));
    const query=(...args)=>spawnSync(process.env.PYTHON || 'python3',[script,'--dir',dir,...args],{
      env:{...process.env,FIGMA_READ_REGISTRY:join(dir,'registry.json')},encoding:'utf8',
    });
    for(const mode of ['none','direct','all']) {
      const result=query('spec',id(1),'--symbols',mode,'--max-lines','2000');
      assert.equal(result.status,0,result.stderr);
      const tree=result.stdout.split('COMPONENT SOURCES')[0];
      for(let i=0;i<4;i++) {
        const row=tree.split(`[INSTANCE] same row (${id(50+i)})`)[1]?.split('[INSTANCE]')[0];
        assert.ok(row,tree);
        assert.ok(row.includes(`(${id(101+i*10)})`),row);
        assert.ok(row.includes('arbitrary icon property'),row);
        assert.match(row,/guidPath=/);
        if(!renamed) assert.ok(row.includes(['textEdit','trashCan','bookmark','plus'][i]),row);
      }
      assert.ok(tree.includes(`<def ${id(800)}>` ) === false);
      assert.match(tree,/inspect 87:250/);
      if(mode==='none') assert.doesNotMatch(result.stdout,/COMPONENT SOURCES/);
      else {
        const components=result.stdout.split('COMPONENT SOURCES')[1];
        for(let i=0;i<4;i++) assert.ok(components.includes(`(${id(101+i*10)})`),components);
        if(mode==='all') assert.ok(components.includes(`[SYMBOL] layer 30 (${id(30)})`) || renamed);
        else assert.ok(!components.includes(`[SYMBOL] layer 30 (${id(30)})`));
      }
      assert.ok(result.stdout.includes(`assets ${id(1)}`));
      assert.doesNotMatch(result.stdout,/library component/);
    }
    const inspect=query('inspect',id(51));
    assert.equal(inspect.status,0,inspect.stderr);
    for(const expected of ['copy 7','still readable','nested text','false',`<def ${id(801)}>`,`guidPath=${id(21)}/${id(31)}`,`(${id(111)})`]) assert.ok(inspect.stdout.includes(expected),inspect.stdout);
    const unknown=query('inspect',id(52));
    assert.ok(unknown.stdout.includes(`guidPath=${id(902)}`));
    assert.ok(unknown.stdout.includes(`(${id(121)})`));
    writeFileSync(join(dir,'lookup.json'),'{}');
    assert.ok(query('inspect',id(52)).stdout.includes(`<def ${id(800)}>`));
    const cut=query('spec',id(1),'--max-lines','1');
    assert.equal(cut.status,0,cut.stderr);
    assert.match(cut.stdout,/Re-run with --max-lines/);
    assert.ok(cut.stdout.includes(`assets ${id(1)}`));
    assert.match(query('assets',id(1)).stderr,/original .fig/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
