import { readFileSync } from 'node:fs';
import { decodeFig } from './fig-source.mjs';
import { createImageCollector } from './raster-assets.mjs';

try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const collect = createImageCollector(decodeFig(request.figPath).decoded);
  console.log(JSON.stringify(request.nodes.map(id => {
    try { return collect(id); }
    catch (error) { return {id, assets:[], warnings:[], errors:[error.message]}; }
  })));
} catch (error) {
  console.error(`export: ${error.message}`);
  process.exitCode = 1;
}
