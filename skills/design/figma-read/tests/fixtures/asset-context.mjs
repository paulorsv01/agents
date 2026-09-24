export function contextFixture(session = 41, offset = 0, renamed = false) {
  const g = id => ({sessionID:session, localID:id + offset});
  const image = byte => ({type:'IMAGE', image:{hash:new Uint8Array(20).fill(byte)}, originalImageWidth:73, originalImageHeight:29});
  const node = (id, type, parent, extra = {}) => ({guid:g(id), type, name:renamed ? '' : `layer ${id}`,
    ...(parent ? {parentIndex:{guid:g(parent)}} : {}), ...extra});
  const swap = (symbol, resolved = false) => ({defID:g(800), varValue:{[resolved ? 'resolvedDataType' : 'dataType']:'SYMBOL_ID', value:{symbolIdValue:{guid:g(symbol)}}}});
  const nodes = [
    node(1, 'FRAME'),
    node(2, 'INSTANCE', 1, {symbolData:{symbolID:g(10), symbolOverrides:[{guidPath:{guids:[g(111)]}, fillPaints:[image(2)]}]}}),
    node(3, 'INSTANCE', 1, {symbolData:{symbolID:g(10), symbolOverrides:[{guidPath:{guids:[g(111)]}, fillPaints:[image(3)]}]}}),
    node(4, 'RECTANGLE', 1, {fillPaints:[image(4)]}),
    node(5, 'GROUP', 1, {visible:false}),
    node(6, 'RECTANGLE', 5, {fillPaints:[image(2)]}),
    node(7, 'RECTANGLE', 1, {fillPaints:[{...image(4),visible:false}]}),
    node(10, 'SYMBOL', null, {size:{x:73,y:29}}),
    node(11, 'RECTANGLE', 10, {overrideKey:g(111), fillPaints:[image(1)]}),
    node(12, 'INSTANCE', 1, {symbolData:{symbolID:g(999)}}),
    node(13, 'INSTANCE', 1, {symbolData:{symbolID:g(13)}}),
    node(20, 'SYMBOL'),
    node(21, 'INSTANCE', 20, {symbolData:{symbolID:g(30)}}),
    node(30, 'SYMBOL'),
    node(31, 'INSTANCE', 30, {symbolData:{symbolID:g(40)}}),
    node(40, 'SYMBOL'),
    node(41, 'VECTOR', 40, {size:{x:31,y:17}}),
  ];
  for (let i=0;i<4;i++) {
    const parent=100+i*10, symbol=parent+1;
    nodes.push(node(parent,'FRAME',null,{name:renamed?'repeated':`choice ${i}`}),
      node(symbol,'SYMBOL',parent,{name:'mode=plain',size:{x:31+i,y:17+i}}),
      node(parent+2,'VECTOR',symbol,{size:{x:31+i,y:17+i}}),
      node(50+i,'INSTANCE',1,{symbolData:{symbolID:g(20),symbolOverrides:[{
        guidPath:{guids:i===0?[g(21)]:i===1?[g(21),g(31)]:[g(900+i)]},
        componentPropAssignments:[swap(symbol,i%2===1)],
      }]}}));
  }
  nodes.push(node(60,'INSTANCE',1,{symbolData:{symbolID:g(20)},componentPropAssignments:[swap(70)]}),
    node(70,'SYMBOL',null,{fillPaints:[image(5)]}),
    node(61,'INSTANCE',1,{symbolData:{symbolID:g(20),symbolOverrides:[{guidPath:{guids:[g(21),g(31)]},symbolData:{symbolID:g(70)}}]}}),
    node(62,'INSTANCE',1,{componentPropAssignments:[swap(998)]}),
    node(63,'INSTANCE',1,{componentPropAssignments:[swap(63)]}));
  return {decoded:{nodeChanges:nodes}, id:n=>`${session}:${n+offset}`, hash:n=>Buffer.alloc(20,n).toString('hex')};
}
