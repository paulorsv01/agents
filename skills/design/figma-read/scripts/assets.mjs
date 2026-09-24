import { readFileSync } from 'node:fs';
import { decodeFig } from './fig-source.mjs';
import { createAssetCollector } from './asset-context.mjs';

try {
  const request = JSON.parse(readFileSync(0,'utf8'));
  const collect = createAssetCollector(decodeFig(request.figPath).decoded);
  const roots = request.nodes.map(root => {
    try { return collect(root); }
    catch (error) { return {root,files:[],vectors:[],warnings:[],errors:[error.message]}; }
  });
  console.log(JSON.stringify({version:1,document:{figPath:request.figPath,fileKey:request.fileKey ?? null},roots}));
} catch (error) {
  console.error(`assets: ${error.message}`);
  process.exitCode = 1;
}
