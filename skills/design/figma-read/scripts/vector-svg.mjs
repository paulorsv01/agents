const gid = g => g ? `${g.sessionID ?? 0}:${g.localID ?? 0}` : null;
const identity = [1, 0, 0, 1, 0, 0];
const number = n => {
  if (!Number.isFinite(n)) throw new Error('Non-finite vector coordinate; flatten this vector in Figma and re-export the .fig.');
  return String(Number(n.toFixed(6)));
};
const matrix = t => t ? [t.m00, t.m10, t.m01, t.m11, t.m02, t.m12] : identity;
const multiply = (a, b) => [
  a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
  a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
  a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5],
];
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
const visible = n => n.visible !== false && (n.opacity ?? 1) > 0;

export function readNetwork(bytes) {
  const b = Buffer.from(bytes);
  let offset = 0;
  const read = method => {
    if (offset + 4 > b.length) throw new Error('Truncated vector network; re-export the .fig.');
    const v = b[method](offset); offset += 4; return v;
  };
  const u32 = () => read('readUInt32LE');
  const f32 = () => read('readFloatLE');
  const vc = u32(), sc = u32(), rc = u32();
  if (12 + vc*12 + sc*28 + rc*8 > b.length) throw new Error('Invalid vector network counts; re-export the .fig.');
  const vertices = Array.from({length:vc}, () => ({flags:u32(), x:f32(), y:f32()}));
  const segments = Array.from({length:sc}, () => ({flags:u32(), start:u32(), sx:f32(), sy:f32(), end:u32(), ex:f32(), ey:f32()}));
  for (const s of segments) if (s.start >= vc || s.end >= vc) throw new Error('Invalid vector vertex index; re-export the .fig.');
  const regions = Array.from({length:rc}, () => {
    const winding = u32(), count = u32();
    if (winding > 1 || count > (b.length-offset)/4) throw new Error('Unsupported vector region; flatten the vector and re-export the .fig.');
    const loops = Array.from({length:count}, () => {
      const count = u32();
      if (!count || count > (b.length-offset)/4) throw new Error('Invalid vector loop length; re-export the .fig.');
      return Array.from({length:count}, () => {
        const i = u32();
        if (i >= sc) throw new Error('Invalid vector segment index; re-export the .fig.');
        return i;
      });
    });
    return {winding, loops};
  });
  if (offset !== b.length) throw new Error('Unsupported vector network trailing data; flatten the vector and re-export the .fig.');
  if (!regions.length) throw new Error('Vector has no filled regions; outline its stroke in Figma and re-export the .fig.');
  return {vertices, segments, regions};
}

export function regionPaths(bytes, transform = identity) {
  const {vertices, segments, regions} = readNetwork(bytes);
  const point = (v, dx=0, dy=0) => {
    const x = v.x+dx, y = v.y+dy;
    return `${number(transform[0]*x+transform[2]*y+transform[4])} ${number(transform[1]*x+transform[3]*y+transform[5])}`;
  };
  const loopPath = indices => {
    const trace = start => {
      let current = start;
      const commands = [`M ${point(vertices[start])}`];
      for (const index of indices) {
        const s = segments[index];
        const forward = s.start === current;
        if (!forward && s.end !== current) return null;
        const end = forward ? s.end : s.start;
        const [sx, sy, ex, ey] = forward ? [s.sx,s.sy,s.ex,s.ey] : [s.ex,s.ey,s.sx,s.sy];
        commands.push(sx || sy || ex || ey
          ? `C ${point(vertices[current],sx,sy)} ${point(vertices[end],ex,ey)} ${point(vertices[end])}`
          : `L ${point(vertices[end])}`);
        current = end;
      }
      return current === start ? [...commands, 'Z'].join(' ') : null;
    };
    const first = segments[indices[0]];
    const result = trace(first.start) ?? trace(first.end);
    if (!result) throw new Error('Disconnected vector region; flatten the vector in Figma and re-export the .fig.');
    return result;
  };
  return regions.map(r => ({rule:r.winding === 0 ? 'evenodd' : 'nonzero', d:r.loops.map(loopPath).join(' ')}));
}

export function createExporter(decoded) {
  const nodes = new Map((decoded.nodeChanges ?? []).map(n => [gid(n.guid),n]));
  const children = new Map();
  const tokens = new Map();
  for (const n of nodes.values()) {
    const parent = gid(n.parentIndex?.guid);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(n);
    if (n.type === 'VARIABLE' && n.key) tokens.set(n.key, n.name);
  }
  for (const list of children.values()) list.sort((a,b) => {
    const x = a.parentIndex?.position ?? '', y = b.parentIndex?.position ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return function exportNode(id, currentColor = false) {
    const selected = nodes.get(id);
    if (!selected) throw new Error(`Node ${id} is absent from the .fig; run query.py find to locate it in a fresh cache.`);
    if (!visible(selected)) throw new Error('Node is hidden; select a visible VECTOR or icon SYMBOL with query.py tree.');
    const warnings = [], vectors = [];
    const unsupported = n => {
      const hint = n.type === 'INSTANCE' ? 'Select its source SYMBOL with query.py inspect; instance overrides are not supported by svg.'
        : 'Flatten it to a filled VECTOR in Figma and re-export the .fig, then select that VECTOR.';
      throw new Error(`${n.type} ${gid(n.guid)} (${n.name}) is not supported. ${hint}`);
    };
    const checkAppearance = n => {
      if ((n.effects ?? []).some(visible) || n.isMask || ![undefined,'NORMAL','PASS_THROUGH'].includes(n.blendMode)) {
        throw new Error(`Node ${gid(n.guid)} uses effects, a mask or blending; flatten its appearance in Figma and re-export the .fig.`);
      }
    };
    const walk = (n, parentMatrix, opacity, root=false) => {
      if (!visible(n)) return;
      checkAppearance(n);
      const transform = root ? parentMatrix : multiply(parentMatrix,matrix(n.transform));
      opacity *= n.opacity ?? 1;
      if (n.type === 'VECTOR') vectors.push({node:n,transform,opacity});
      else if (['SYMBOL','FRAME','GROUP'].includes(n.type)) {
        if ((n.fillPaints ?? []).some(visible) || (n.strokePaints ?? []).some(visible)) {
          warnings.push(`Ignoring container paint on ${gid(n.guid)}: svg exports visible VECTOR layers only.`);
        }
        for (const child of children.get(gid(n.guid)) ?? []) walk(child,transform,opacity);
      } else unsupported(n);
    };
    let frame = selected;
    if (selected.type === 'VECTOR') {
      let parent = nodes.get(gid(selected.parentIndex?.guid));
      let transform = matrix(selected.transform);
      const seen = new Set([id]);
      while (parent && parent.type === 'GROUP' && !seen.has(gid(parent.guid))) {
        seen.add(gid(parent.guid));
        transform = multiply(matrix(parent.transform),transform);
        parent = nodes.get(gid(parent.parentIndex?.guid));
      }
      if (parent && ['FRAME','SYMBOL'].includes(parent.type)) frame = parent;
      else { transform = identity; warnings.push('No enclosing icon frame: using the vector size without external placement.'); }
      checkAppearance(selected);
      vectors.push({node:selected,transform,opacity:selected.opacity ?? 1});
    } else if (['SYMBOL','FRAME','GROUP'].includes(selected.type)) walk(selected,identity,1,true);
    else unsupported(selected);
    if (!vectors.length) throw new Error('No visible VECTOR found; use query.py tree to select a filled vector or icon SYMBOL.');
    if (vectors.length > 1) warnings.push(`Exporting ${vectors.length} visible VECTOR nodes: ${vectors.map(v=>gid(v.node.guid)).join(', ')}. Check for visible construction layers.`);
    const size = frame.size?.value ?? frame.size;
    if (!(size?.x > 0 && size?.y > 0)) throw new Error('Node has no usable frame size; select an icon FRAME or SYMBOL.');
    const colors = new Set(), paths = [];
    for (const {node:n,transform,opacity} of vectors) {
      if ((n.strokePaints ?? []).some(visible)) throw new Error(`VECTOR ${gid(n.guid)} has a stroke; outline the stroke in Figma and re-export the .fig.`);
      const fills = (n.fillPaints ?? []).filter(visible);
      if (fills.length !== 1 || fills[0].type !== 'SOLID' || !fills[0].color) throw new Error(`VECTOR ${gid(n.guid)} needs one solid fill; flatten gradients/multiple paints in Figma or select another VECTOR.`);
      if ((n.vectorData?.styleOverrideTable ?? []).some(s => (s.cornerRadius ?? 0) !== 0 || s.fillPaints?.length)) throw new Error('Vector has rounded corners or per-region paints; flatten its appearance in Figma and re-export the .fig.');
      const blob = decoded.blobs?.[n.vectorData?.vectorNetworkBlob]?.bytes;
      if (!blob) throw new Error(`VECTOR ${gid(n.guid)} has no vectorNetworkBlob; flatten it in Figma and re-export the .fig.`);
      const normalized = n.vectorData.normalizedSize, actual = n.size?.value ?? n.size;
      if (!(normalized?.x > 0 && normalized?.y > 0 && actual?.x > 0 && actual?.y > 0)) throw new Error('Vector has a degenerate size; outline or flatten it in Figma and re-export the .fig.');
      const scaled = multiply(transform,[actual.x/normalized.x,0,0,actual.y/normalized.y,0,0]);
      const paint = fills[0], c = paint.color;
      const color = '#'+[c.r,c.g,c.b].map(v => Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0')).join('').toUpperCase();
      colors.add(color);
      const key = paint.colorVar?.value?.alias?.assetRef?.key;
      const token = tokens.get(key) ?? key;
      for (const region of regionPaths(blob,scaled)) paths.push(`  <path d="${region.d}" fill="${currentColor ? 'currentColor' : color}" fill-opacity="${number(opacity*(paint.opacity ?? 1)*(c.a ?? 1))}" fill-rule="${region.rule}"${token ? ` data-figma-token="${escape(token)}"` : ''}/>`);
    }
    if (currentColor && colors.size > 1) throw new Error('--current-color requires a monochrome icon; omit it to preserve the design colors.');
    return {id,name:selected.name,warnings,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(size.x)} ${number(size.y)}">\n${paths.join('\n')}\n</svg>\n`};
  };
}
