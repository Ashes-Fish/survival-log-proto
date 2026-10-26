// Restricted source-derived reconstruction of GuidanceFurniture 9111 only.
// Browser instance IDs 1..N are local identities, never native game entity IDs.
function one(rows,id,name){const matches=rows?.filter(r=>r.ID===id);if(matches?.length!==1)throw new TypeError(`Missing or ambiguous ${name} ${id}`);return matches[0];}
export function createPrologueWardrobe(tables){
  const guidance=one(tables.GuidanceFurniture,9111,'GuidanceFurniture');
  if(guidance.ChapterType!==4||guidance.FurnitureId!==9111||guidance.MapPointID!==8||guidance.PosType!==1||guidance.PosPoint!=='HomeXuZhang_09'||guidance.PackageID!==0||guidance.IsLootSeed||!guidance.IsShow)throw new TypeError('Unsupported wardrobe initialization');
  if(JSON.stringify(guidance.ItemIdList)!=='[9030,9031,9032]'||JSON.stringify(guidance.ItemCountList)!=='[1,1,1]')throw new TypeError('Unsupported wardrobe contents');
  const furniture=one(tables.Furniture,9111,'Furniture');
  if(furniture.BagId!==110006)throw new TypeError('Unsupported wardrobe bag');
  const bag=one(tables.Bag,furniture.BagId,'Bag');
  const [width,height]=bag.Size||[];
  if(width!==5||height!==3)throw new TypeError('Unsupported wardrobe dimensions');
  const map=tables.PrologueMap?.map;
  if(map?.Name!=='Home_XUZhang')throw new TypeError('Unsupported prologue map');
  const anchors=map.MapPoints?.filter(p=>p.NodeName===guidance.PosPoint);
  if(anchors?.length!==1||anchors[0].WorldPos?.length!==3||!anchors[0].WorldPos.every(Number.isFinite)||anchors[0].WoldRotation?.length!==4||!anchors[0].WoldRotation.every(Number.isFinite))throw new TypeError('Missing or ambiguous wardrobe anchor');
  const configs=guidance.ItemIdList.map(id=>one(tables.Item,id,'Item'));
  for(const item of configs)if(item.Size?.length!==2||!item.Size.every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(item.UseTimes)||item.UseTimes<1)throw new TypeError('Unsupported item layout or uses');
  configs.sort((a,b)=>b.Size[0]*b.Size[1]-a.Size[0]*a.Size[1]||a.ID-b.ID);
  const occupied=Array.from({length:height},()=>Array(width).fill(false)),items=[];
  for(const config of configs){
    const [w,h]=config.Size;let position;
    for(let y=0;y<=height-h&&!position;y++)for(let x=0;x<=width-w;x++){
      let free=true;for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)if(occupied[y+dy][x+dx])free=false;
      if(free){position={x,y};break;}
    }
    if(!position)throw new RangeError('Wardrobe contents do not fit');
    const {x,y}=position;for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)occupied[y+dy][x+dx]=true;
    items.push({instanceId:items.length+1,configId:config.ID,count:1,useTimes:config.UseTimes,x,y,w,h,name:config.ItemName_Local,webIcon:config.WebIcon});
  }
  return {furnitureConfigId:9111,guidanceConfigId:9111,bagConfigId:bag.ID,name:furniture.Name_Local,width,height,items,
    anchor:structuredClone(anchors[0]),mapPointId:guidance.MapPointID,isBagLocked:guidance.IsBagLocked,
    provenance:{identity:'browser-local numeric instanceId; not native entity ID',chapterId:0,chapterType:4,mapName:map.Name,positionKey:guidance.PosPoint,
      sourceTables:['Config_GuidanceFurniture','Config_Furniture','Config_Bag','Config_Item','PrologueMap'],
      mapExtraction:structuredClone(tables.PrologueMap.provenance??null),
      derivation:'area descending then ConfigId ascending; row-major first-fit; no rotation',
      limitations:['Does not create player backpack contents','Does not infer native IDs or perishable-item runtime state']}};
}
