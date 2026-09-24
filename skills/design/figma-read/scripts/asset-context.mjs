import { createHash } from 'node:crypto';
import { createExporter } from './vector-svg.mjs';

const gid = g => g && Number.isInteger(g.sessionID) && Number.isInteger(g.localID) ? `${g.sessionID}:${g.localID}` : null;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function symbolAssignments(value) {
  return (value.componentPropAssignments ?? []).flatMap(assignment => {
    const variable = assignment.varValue;
    const symbol = gid(variable?.value?.symbolIdValue?.guid);
    if (!symbol || ![variable.dataType, variable.resolvedDataType].includes('SYMBOL_ID')) return [];
    return [{symbol, defID:gid(assignment.defID)}];
  });
}

export function createAssetCollector(decoded) {
  const nodes = new Map((decoded.nodeChanges ?? []).map(node => [gid(node.guid), node]));
  const children = new Map();
  for (const node of nodes.values()) {
    const parent = gid(node.parentIndex?.guid);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const exportNode = createExporter(decoded), svgChecks = new Map();
  const label = node => ({id:gid(node.guid), name:node.name ?? '', type:node.type});
  const checkSvg = id => {
    if (!svgChecks.has(id)) {
      try {
        const result = exportNode(id);
        // The digest is what lets the inventory collapse two candidates without
        // guessing: an icon SYMBOL and the single VECTOR inside it export the
        // same bytes, a SYMBOL with two vectors does not. The export already
        // ran to answer `supported`, so proving it costs a hash.
        svgChecks.set(id, {supported:true, command:`svg ${id}`, warnings:result.warnings,
          digest:createHash('sha1').update(result.svg).digest('hex').slice(0,12),
          appearance:'source node only; instance size, color and overrides are not applied'});
      } catch (error) {
        svgChecks.set(id, {supported:false, command:`svg ${id}`, reason:error.message});
      }
    }
    return svgChecks.get(id);
  };
  const hasGeometry = (node, active = new Set()) => {
    const id = gid(node.guid);
    if (active.has(id)) return false;
    if (['VECTOR','BOOLEAN_OPERATION','ELLIPSE','RECTANGLE','ROUNDED_RECTANGLE','LINE','STAR','REGULAR_POLYGON'].includes(node.type)) {
      return node.type === 'VECTOR' || !(node.fillPaints ?? []).some(p => p.type === 'IMAGE');
    }
    const next = new Set([...active, id]);
    return (children.get(id) ?? []).some(child => hasGeometry(child, next));
  };
  return function collect(root) {
    if (!nodes.has(root)) throw new Error(`Node ${root} is absent from the .fig; refresh the cache and use query.py find.`);
    const warnings = new Set(), errors = [], files = new Map(), vectors = new Map();
    const ancestors = [];
    let ancestor = nodes.get(gid(nodes.get(root).parentIndex?.guid));
    const seen = new Set([root]);
    while (ancestor && !seen.has(gid(ancestor.guid))) {
      seen.add(gid(ancestor.guid));
      ancestors.unshift(ancestor);
      ancestor = nodes.get(gid(ancestor.parentIndex?.guid));
    }

    // Resolve each path segment inside its component scope, including published aliases.
    const resolvePath = (tree, path) => {
      let scope = tree;
      for (const [index, key] of path.entries()) {
        const matches = [];
        const scan = entry => {
          if ([gid(entry.node.guid), gid(entry.node.overrideKey), gid(entry.node.publishID)].includes(key)) matches.push(entry);
          for (const child of entry.children) scan(child);
        };
        if (!scope || !key) return null;
        scan(scope);
        if (matches.length !== 1) return null;
        scope = matches[0];
        if (index < path.length - 1) scope = scope.resolvedChoice ?? scope.base ?? scope;
      }
      return path.length ? scope : null;
    };
    const replacePaints = entry => {
      for (const reference of entry.paints) reference.overridden = true;
      if (entry.base) replacePaints(entry.base);
    };
    const propertySlot = (scope, defID) => {
      if (!scope || !defID) return null;
      const matches = [];
      const scan = entry => {
        if ((entry.node.componentPropRefs ?? []).some(ref =>
          gid(ref.defID) === defID && ref.componentPropNodeField === 'OVERRIDDEN_SYMBOL_ID')) matches.push(entry);
        for (const child of entry.children) scan(child);
      };
      scan(scope);
      return matches.length === 1 && matches[0].base ? matches[0] : null;
    };
    const build = (id, context, active) => {
      const node = nodes.get(id);
      if (!node) {
        warnings.add(`Component ${id} is absent from the .fig; its contents are unresolved.`);
        return null;
      }
      if (active.has(id)) {
        warnings.add(`Cycle at ${id}; this reference was not expanded.`);
        return null;
      }
      const next = new Set([...active,id]);
      const entry = {node, context:{...context, path:[...context.path,label(node)],
        instances:node.type === 'INSTANCE' ? [...context.instances,id] : context.instances},
        children:[], base:null, choices:[], paints:[], hidden:node.visible === false, overridden:false, unresolved:false};
      entry.paints.push({value:node, sourceNode:id, origin:context.origin, guidPath:[], overridden:false});
      for (const child of children.get(id) ?? []) {
        const built = build(gid(child.guid), entry.context, next);
        if (built) entry.children.push(built);
      }
      const source = gid(node.symbolData?.symbolID);
      if (source) entry.base = build(source, {...entry.context,origin:'component-default'}, next);
      if (entry.base && own(node,'fillPaints')) replacePaints(entry.base);
      const choice = (symbol, target, selection, origin) => {
        const chosen = build(symbol, {...(target ?? entry).context, origin, selection}, next);
        if (chosen) {
          chosen.unresolved = !selection.replacementResolved;
          (target ?? entry).choices.push(chosen);
          if (target && selection.replacementResolved) target.resolvedChoice = chosen;
        }
      };
      const propertyChoice = (assignment, target, selection, scope) => {
        const slot = propertySlot(scope,assignment.defID);
        if (slot) slot.base.overridden = true;
        else {
          (target ?? entry).unresolved = true;
          warnings.add(`Property ${assignment.defID ?? '(unknown)'} on ${id} at ${selection.guidPath.join('/')}: selected symbol is known; replacement slot is unresolved.`);
        }
        choice(assignment.symbol,slot ?? target,{...selection,...assignment,replacementResolved:!!slot,
          slot:slot ? gid(slot.node.guid) : null},'property-swap');
      };
      for (const assignment of symbolAssignments(node)) {
        propertyChoice(assignment,entry,{owner:id,guidPath:[],targetResolved:true},entry.base);
      }
      for (const override of node.symbolData?.symbolOverrides ?? []) {
        const path = (override.guidPath?.guids ?? []).map(gid);
        const target = resolvePath(entry.base, path);
        const selection = {owner:id, guidPath:path, targetResolved:!!target};
        if (!target) {
          entry.unresolved = true;
          warnings.add(`Override target ${path.join('/') || '(empty path)'} on ${id} not found unambiguously in its component; relationship is unresolved.`);
        }
        if (own(override,'fillPaints')) {
          if (target) replacePaints(target);
          (target ?? entry).paints.push({value:override, sourceNode:id, origin:'override', guidPath:path,
            selection, unresolved:!target, overridden:false});
        }
        if (own(override,'visible') && target) target.hidden = override.visible === false;
        const swapped = gid(override.symbolData?.symbolID);
        if (swapped) {
          const replaced = target?.base;
          if (replaced) replaced.overridden = true;
          choice(swapped,target,{...selection,symbol:swapped,replacementResolved:!!replaced},'override');
        }
        for (const assignment of symbolAssignments(override)) {
          propertyChoice(assignment,target,selection,target?.base);
        }
      }
      return entry;
    };
    const tree = build(root,{path:ancestors.map(label),instances:[],origin:'fill',selection:null},new Set());
    const state = flags => flags.overridden ? 'overridden' : flags.hidden ? 'hidden' : flags.unresolved ? 'unresolved' : 'referenced';
    const walk = (entry, inherited) => {
      const flags = {hidden:inherited.hidden || entry.hidden, overridden:inherited.overridden || entry.overridden,
        unresolved:inherited.unresolved || entry.unresolved};
      const occurrence = (sourceNode, extra = {}, status = flags) => ({root,sourceNode,
        path:entry.context.path, instances:entry.context.instances, origin:entry.context.origin,
        selection:entry.context.selection, ...extra, state:state(status), known:{...status}});
      for (const reference of entry.paints) {
        for (const [index, paint] of (reference.value.fillPaints ?? []).entries()) {
          if (paint.type !== 'IMAGE') continue;
          const bytes = paint.image?.hash;
          if (!(bytes instanceof Uint8Array || Array.isArray(bytes)) || bytes.length !== 20 ||
              !Array.from(bytes).every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
            errors.push(`${reference.sourceNode}: fillPaints[${index}] has no valid 20-byte image hash; re-export the .fig.`);
            continue;
          }
          const hash = Buffer.from(bytes).toString('hex');
          if (!files.has(hash)) files.set(hash,{hash,selector:hash,occurrences:[]});
          files.get(hash).occurrences.push(occurrence(reference.sourceNode,{
            origin:reference.origin, guidPath:reference.guidPath, paint:index, imageName:paint.image.name ?? '',
            selection:reference.selection ?? entry.context.selection,
            paintDimensions:{width:paint.originalImageWidth ?? null,height:paint.originalImageHeight ?? null,source:'paint-metadata'},
          },{...flags,hidden:flags.hidden || paint.visible === false,
            overridden:flags.overridden || reference.overridden,unresolved:flags.unresolved || !!reference.unresolved}));
        }
      }
      const node = entry.node, id = gid(node.guid);
      if (hasGeometry(node) && ['VECTOR','SYMBOL','BOOLEAN_OPERATION','ELLIPSE','RECTANGLE','ROUNDED_RECTANGLE','LINE','STAR','REGULAR_POLYGON'].includes(node.type)) {
        if (!vectors.has(id)) vectors.set(id,{sourceNode:id,name:node.name ?? '',type:node.type,
          parent:nodes.has(gid(node.parentIndex?.guid)) ? label(nodes.get(gid(node.parentIndex.guid))) : null,
          size:node.size?.value ?? node.size ?? null,svg:checkSvg(id),occurrences:[]});
        vectors.get(id).occurrences.push(occurrence(id));
      }
      for (const child of entry.children) walk(child,flags);
      if (entry.base) walk(entry.base,flags);
      for (const chosen of entry.choices) walk(chosen,flags);
    };
    walk(tree,{hidden:ancestors.some(n=>n.visible === false),overridden:false,unresolved:false});
    return {root,files:[...files.values()],vectors:[...vectors.values()],warnings:[...warnings],errors,
      limits:['References are not a rendered appearance; masks, crop, variable modes and arbitrary overrides are not resolved.',
        'Property swaps resolve replacement only for an unambiguous OVERRIDDEN_SYMBOL_ID binding; other slots remain unresolved.']};
  };
}
