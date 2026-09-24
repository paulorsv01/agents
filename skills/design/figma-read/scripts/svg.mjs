import { readFileSync } from 'fs';
import { decodeFig } from './fig-source.mjs';
import { createExporter } from './vector-svg.mjs';

try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const exportNode = createExporter(decodeFig(request.figPath).decoded);
  const results = request.nodes.map(id => {
    try { return exportNode(id, request.currentColor); }
    catch (e) { return {id, error:e.message}; }
  });
  console.log(JSON.stringify(results));
} catch (e) {
  console.error(`svg: ${e.message}`);
  process.exitCode = 1;
}
