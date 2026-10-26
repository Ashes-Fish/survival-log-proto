// Browser reconstruction rules for inventory plumbing. Not recovered native rules.
export const SCHEMA=1;
const clone=v=>structuredClone(v);
export function createSession(){return {schema:SCHEMA,kind:'survival-log-web-fixture',revision:0,character:'打工仔',bags:[{ownerId:1,name:'随身背包',cols:8,rows:6},{ownerId:2,name:'储物箱',cols:8,rows:6}],items:[
  {id:1,ownerId:1,name:'白米饭',x:0,y:0,w:1,h:1,count:3,icon:'/WebUI/Res/Food/baimifan.png',rarity:0},
  {id:2,ownerId:1,name:'蛋炒饭',x:1,y:0,w:1,h:1,count:2,icon:'/WebUI/Res/Food/danchaofan.png',rarity:0},
  {id:3,ownerId:1,name:'木板',x:2,y:0,w:2,h:1,count:5,icon:'/WebUI/Res/Material/UI_Item_Icon_Mat_M_muban.png',rarity:0},
  {id:4,ownerId:2,name:'奥尔良烤翅',x:0,y:0,w:1,h:1,count:2,icon:'/WebUI/Res/Food/aoerliangkaochi.png',rarity:0}
],journal:['建立网页移植验证存档（测试物资）']};}
export function canPlace(state,item,ownerId,x,y){const bag=state.bags.find(b=>b.ownerId===ownerId);if(!bag||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x+item.w>bag.cols||y+item.h>bag.rows)return false;return !state.items.some(o=>o.id!==item.id&&o.ownerId===ownerId&&x<o.x+o.w&&x+item.w>o.x&&y<o.y+o.h&&y+item.h>o.y);}
function spot(state,item,ownerId){const b=state.bags.find(b=>b.ownerId===ownerId);if(!b)return null;for(let y=0;y<b.rows;y++)for(let x=0;x<b.cols;x++)if(canPlace(state,item,ownerId,x,y))return {x,y};return null;}
export function changeInventory(state,action){
  const next=clone(state);let note;const item=next.items.find(i=>i.id===action.itemId);
  if(action.type==='move'){
    if(!item||!canPlace(next,item,action.ownerId,action.x,action.y))return {ok:false,error:'目标位置放不下这个物品。'};
    Object.assign(item,{ownerId:action.ownerId,x:action.x,y:action.y});note=`移动 ${item.name}`;
  }else if(action.type==='transfer'){
    if(!item)return {ok:false,error:'物品不存在。'};const pos=spot(next,item,action.ownerId);if(!pos)return {ok:false,error:'目标容器没有足够空间。'};Object.assign(item,{ownerId:action.ownerId,...pos});note=`转移 ${item.name}`;
  }else if(action.type==='sort'){
    const items=next.items.filter(i=>i.ownerId===action.ownerId).sort((a,b)=>(b.w*b.h-a.w*a.h)||a.id-b.id);
    next.items=next.items.filter(i=>i.ownerId!==action.ownerId);
    for(const entry of items){const pos=spot(next,entry,action.ownerId);if(!pos)return {ok:false,error:'无法整理，原布局已保留。'};Object.assign(entry,pos);next.items.push(entry);}note='整理物品';
  }else return {ok:false,error:'这项原生动作尚未恢复。'};
  next.revision++;next.journal.unshift(`${String(next.revision).padStart(3,'0')} · ${note}`);next.journal=next.journal.slice(0,100);return {ok:true,state:next};
}
export function validateSession(raw){
  if(!raw||raw.schema!==SCHEMA||raw.kind!=='survival-log-web-fixture'||!Number.isInteger(raw.revision)||raw.revision<0||!Array.isArray(raw.bags)||raw.bags.length!==2||!Array.isArray(raw.items)||raw.items.length>300||!Array.isArray(raw.journal)||raw.journal.length>100)throw new Error('存档格式不匹配。仅支持本网页版本导出的存档。');
  if(typeof raw.character!=='string'||raw.character.length>50||raw.journal.some(x=>typeof x!=='string'||x.length>300))throw new Error('存档文本不合法。');
  const owners=new Set();for(const b of raw.bags){if(!Number.isSafeInteger(b.ownerId)||b.ownerId<1||owners.has(b.ownerId)||typeof b.name!=='string'||b.name.length>100||!Number.isInteger(b.cols)||!Number.isInteger(b.rows)||b.cols<1||b.cols>30||b.rows<1||b.rows>30)throw new Error('存档容器不合法。');owners.add(b.ownerId);}
  if(!owners.has(1)||!owners.has(2))throw new Error('缺少容器。');
  const ids=new Set();for(const i of raw.items){if(!Number.isSafeInteger(i.id)||i.id<1||ids.has(i.id)||!Number.isInteger(i.w)||!Number.isInteger(i.h)||i.w<1||i.h<1||!Number.isInteger(i.count)||i.count<1||i.count>99999||typeof i.name!=='string'||i.name.length>100||typeof i.icon!=='string'||!/^\/WebUI\/[\w/.-]+\.(png|webp|jpg)$/.test(i.icon)||i.icon.includes('..')||!canPlace(raw,i,i.ownerId,i.x,i.y))throw new Error('存档物品越界、重叠或格式不合法。');ids.add(i.id);}
  // Keep only the contract's fields; untrusted imports cannot supply extra UI data.
  return {schema:SCHEMA,kind:raw.kind,revision:raw.revision,character:raw.character,bags:raw.bags.map(({ownerId,name,cols,rows})=>({ownerId,name,cols,rows})),items:raw.items.map(({id,ownerId,name,x,y,w,h,count,icon,rarity})=>({id,ownerId,name,x,y,w,h,count,icon,rarity:Number.isInteger(rarity)&&rarity>=0&&rarity<=4?rarity:0})),journal:[...raw.journal]};
}
