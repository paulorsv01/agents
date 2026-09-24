const gid = g => g ? `${g.sessionID ?? 0}:${g.localID ?? 0}` : null;

export function createImageCollector(decoded) {
  const nodes = new Map((decoded.nodeChanges ?? []).map(n => [gid(n.guid), n]));
  const children = new Map();
  for (const node of nodes.values()) {
    const parent = gid(node.parentIndex?.guid);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  return function collect(id) {
    if (!nodes.has(id)) throw new Error(`Node ${id} is absent from the .fig; run query.py find in a fresh cache.`);
    const assets = new Map(), visited = new Set(), warnings = new Set(), errors = [];
    const paints = (value, source) => {
      for (const [index, paint] of (value.fillPaints ?? []).entries()) {
        if (paint.type !== 'IMAGE') continue;
        const hash = paint.image?.hash;
        if (!(hash instanceof Uint8Array || Array.isArray(hash)) || hash.length !== 20 ||
            !Array.from(hash).every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
          errors.push(`${source.node}: fillPaints[${index}] has no valid 20-byte image hash; re-export the .fig.`);
          continue;
        }
        const hex = Buffer.from(hash).toString('hex');
        if (!assets.has(hex)) assets.set(hex, {hash:hex, sources:[]});
        assets.get(hex).sources.push({...source, paint:index, imageName:paint.image.name ?? ''});
      }
    };
    const visit = node => {
      const nodeId = gid(node.guid);
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      paints(node, {node:nodeId, name:node.name ?? '', kind:'fill'});
      for (const override of node.symbolData?.symbolOverrides ?? []) {
        paints(override, {node:nodeId, name:node.name ?? '', kind:'override',
          path:(override.guidPath?.guids ?? []).map(gid)});
        const swapped = gid(override.symbolData?.symbolID);
        if (swapped) follow(swapped);
      }
      for (const child of children.get(nodeId) ?? []) visit(child);
      const symbol = gid(node.symbolData?.symbolID);
      if (symbol) follow(symbol);
    };
    const follow = symbol => {
      if (nodes.has(symbol)) visit(nodes.get(symbol));
      else warnings.add(`Component ${symbol} is absent from the .fig; only local references and overrides are available.`);
    };
    visit(nodes.get(id));
    if (!assets.size && !errors.length) errors.push('No image references in this node, its subtree, overrides or local components.');
    return {id, assets:[...assets.values()], warnings:[...warnings], errors};
  };
}
