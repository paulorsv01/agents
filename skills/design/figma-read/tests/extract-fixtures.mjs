import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { decodeFig } from '../scripts/fig-source.mjs';
import { createExporter } from '../scripts/vector-svg.mjs';

const source = process.argv[2];
if (!source) throw new Error('usage: node extract-fixtures.mjs <local.fig>');
const {decoded} = decodeFig(source);
const gid = g => g && `${g.sessionID}:${g.localID}`;
const directory = fileURLToPath(new URL('./fixtures/',import.meta.url));
mkdirSync(directory,{recursive:true});
const exportNode = createExporter(decoded);
const cases = [['plus','1:522'],['magnifyingGlass','1:186'],['dots','226:14879'],['quarterNote','30:9614']];
for (const [name,id] of cases) {
  const node = decoded.nodeChanges.find(n=>gid(n.guid)===id);
  const parent = decoded.nodeChanges.find(n=>gid(n.guid)===gid(node.parentIndex.guid));
  const fields = ['guid','parentIndex','name','type','visible','opacity','size','transform','vectorData','fillPaints','strokePaints'];
  const select = n => Object.fromEntries(fields.filter(k=>k in n).map(k=>[k,n[k]]));
  const vector = select(node);
  vector.vectorData = {...node.vectorData,vectorNetworkBlob:0};
  const nodes = [select(parent),vector];
  for (const child of decoded.nodeChanges.filter(n=>gid(n.parentIndex?.guid)===gid(parent.guid) && gid(n.guid)!==id)) nodes.push(select(child));
  const key = node.fillPaints[0].colorVar?.value?.alias?.assetRef?.key;
  const variable = decoded.nodeChanges.find(n=>n.type==='VARIABLE' && n.key===key);
  if (variable) nodes.push({guid:variable.guid,type:'VARIABLE',key,name:variable.name});
  writeFileSync(`${directory}${name}.bin`,node.vectorData && decoded.blobs[node.vectorData.vectorNetworkBlob].bytes);
  writeFileSync(`${directory}${name}.json`,JSON.stringify({id,parent:gid(parent.guid),nodeChanges:nodes},null,2)+'\n');
  writeFileSync(`${directory}${name}.svg`,exportNode(id).svg);
  console.log(`${name}: ${id} (${decoded.blobs[node.vectorData.vectorNetworkBlob].bytes.length} bytes)`);
}
