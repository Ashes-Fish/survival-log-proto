import {createGameClock,tickGameClock,clockReading} from './game-clock.mjs';
import {attributeWriteback} from './attribute-writeback.mjs';
import {createPrologueProbe,advancePrologueProbe,startProbeMeal,startProbeNap,probeReading,validatePrologueProbe,cancelProbeMeal,probeTutorialEvent} from './prologue-probe.mjs';
import {tutorialRows} from './tutorial.mjs';
const $=id=>document.getElementById(id);
const tables=Object.fromEntries(await Promise.all(['PlayAttribute','Chapter','Effect','Item','Action','GuidanceFurniture','Furniture','Bag','Guide','FurnitureFunc'].map(async name=>{const r=await fetch(`/data/Config_${name}.json`);if(!r.ok)throw Error(`缺少原版配置 ${name}`);return [name,await r.json()];})));
tables.PrologueMap=await (await fetch('/data/PrologueMap.json')).json();
const initial=()=>({schema:2,kind:'survival-log-rules-lab',clock:createGameClock({timerKind:'countUp',gameSeconds:0,day:0,toolsetTimeScale:120,started:true,battleScale:1}),foodResult:null,probe:createPrologueProbe(tables)});
let state=initial();
function validate(raw){
  if(!raw||![1,2].includes(raw.schema)||raw.kind!=='survival-log-rules-lab')throw Error('验证状态格式不正确');
  const c=raw.clock;
  if(!c||c.timerKind!=='countUp'||c.toolsetTimeScale!==120||c.started!==true||c.battleScale!==1||c.frozenGameSeconds!==0||typeof c.clockFrozen!=='boolean'||!Number.isSafeInteger(c.day)||c.day<0||c.day>10000||!Number.isFinite(c.internalTime)||c.internalTime<0||c.internalTime>=720||!Number.isFinite(c.timeSyncTimer)||c.timeSyncTimer<0||c.timeSyncTimer>=30)throw Error('时钟状态不正确');
  const result=raw.foodResult;
  const expected=attributeWriteback({attribute:'Satiety',current:19,amount:20,maximum:100,sourceType:2,foodSubCategory:1,isLeadingRole:true});
  if(result!==null&&JSON.stringify(result)!==JSON.stringify(expected))throw Error('进食对照记录不正确');
  return {schema:2,kind:raw.kind,clock:{timerKind:'countUp',internalTime:c.internalTime,frozenGameSeconds:0,day:c.day,toolsetTimeScale:120,started:true,battleScale:1,clockFrozen:c.clockFrozen,timeSyncTimer:c.timeSyncTimer},foodResult:result?expected:null,probe:raw.schema===1?createPrologueProbe(tables):validatePrologueProbe(raw.probe,tables)};
}
function render(){const time=clockReading(state.clock);$('clock').textContent=`Day ${time.day} · ${String(Math.floor(time.gameSeconds/3600)).padStart(2,'0')}:${String(Math.floor(time.gameSeconds/60)%60).padStart(2,'0')}:${String(time.gameSeconds%60).padStart(2,'0')}`;$('freeze').textContent=state.clock.clockFrozen?'解除冻结':'冻结时钟';$('food').textContent=`饱腹 ${state.foodResult?.value??19}/100`;$('compare').disabled=!!state.foodResult;$('comparison').textContent=state.foodResult?'计算结果 39，与已记录的原版饱腹结果一致；完整动作仍待验证。':'尚未执行本次计算。';$('record').textContent=JSON.stringify(state,null,2);renderProbe();}
function renderProbe(){
 const p=state.probe,r=probeReading(p,tables),seconds=r.gameSeconds;
 $('probe-clock').textContent=`DAY ${r.day+1} · ${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
 $('probe-values').replaceChildren(...[['Satiety','饱腹'],['Morale','心态'],['Stamina','精力'],['Vitality','生命']].map(([key,label])=>{const el=document.createElement('div');el.className='attribute';const a=r.attributes[key];el.textContent=`${label} ${Math.floor(a.value)} / ${a.maximum}`;return el;}));
 $('probe-buffs').textContent=`重度感染${p.hunger.present?' · 饥饿':''}${p.fatigue.present?' · 疲劳':''}${p.dying.present?' · 垂危':''} · ${p.meal?.status==='active'?'进食中':p.meal?.status==='completed'?'已完成进食':'尚未进食'}${p.nap?.status==='active'?' · 小睡中':p.nap?.status==='completed'?' · 已睡醒':''} · 时间倍率 ×${r.speedScale}`;
 const cells=[];for(let y=0;y<3;y++)for(let x=0;x<5;x++){const el=document.createElement('div');el.className='slot';const i=p.wardrobe.find(i=>i.x===x&&i.y===y);if(i){const item=tables.Item.find(r=>r.ID===i.configId),img=document.createElement('img');img.src='/WebUI/'+item.WebIcon.replace('../../','');img.alt=item.ItemName_Local;el.append(img);el.title=item.ItemName_Local;}cells.push(el);} $('probe-wardrobe').replaceChildren(...cells);
 $('probe-pause').textContent=p.paused?'继续对照':'暂停对照';$('probe-meal').disabled=p.paused||p.meal?.status==='active'||p.nap?.status==='active'||!p.wardrobe.some(i=>i.configId===9030);$('probe-before').disabled=p.paused||p.frame>=3151;$('probe-after').disabled=p.paused||!p.meal||p.frame>=3752;$('probe-end').disabled=p.paused||p.frame>=5550;
 $('probe-cancel').disabled=p.paused||p.meal?.status!=='active';
 $('probe-tutorial').replaceChildren(...tutorialRows(tables.Guide,p.tutorial).map(row=>{const li=document.createElement('li');li.textContent=`${row.completed?'✓':'○'} ${row.text}`;return li;}));
 $('probe-story').disabled=p.paused||p.tutorial.completedIds.includes(101);$('probe-open').disabled=p.paused;
 $('probe-late').disabled=p.paused||p.frame>=6751;
 $('probe-chips').disabled=p.paused||p.meal?.status==='active'||p.nap?.status==='active'||!p.wardrobe.some(i=>i.configId===9031);
 $('probe-last').disabled=p.paused||p.frame>=7650;
 const busy=p.meal?.status==='active'||p.nap?.status==='active';
 $('probe-nap').disabled=p.paused||busy;$('probe-wake').disabled=p.paused||p.nap?.status!=='active';
 $('probe-advance').disabled=p.paused||p.frame+150>7650;
}
function perform(fn){return async()=>{try{await fn();render();}catch(e){$('status').textContent=e.message;}};}
$('advance').onclick=perform(()=>{const seconds=Number($('seconds').value);if(!Number.isInteger(seconds)||seconds<0||seconds>600)throw Error('请输入 0–600 的整数秒数');let c=state.clock;for(let n=0;n<seconds*30;n++)c=tickGameClock(c,{deltaTime:1/30,unscaledDeltaTime:1/30}).clock;state={...state,clock:c};$('status').textContent='已完成时钟算术推进。';});
$('freeze').onclick=perform(()=>{state={...state,clock:{...state.clock,clockFrozen:!state.clock.clockFrozen}};});
$('compare').onclick=perform(()=>{if(state.foodResult)return;state={...state,foodResult:attributeWriteback({attribute:'Satiety',current:19,amount:20,maximum:100,sourceType:2,foodSubCategory:1,isLeadingRole:true})};});
$('probe-before').onclick=perform(()=>{state.probe=advancePrologueProbe(state.probe,3151-state.probe.frame,tables);});
$('probe-story').onclick=perform(()=>{state.probe=probeTutorialEvent(state.probe,'story',tables);});
$('probe-open').onclick=perform(()=>{state.probe=probeTutorialEvent(state.probe,'wardrobe',tables);});
$('probe-cancel').onclick=perform(()=>{state.probe=cancelProbeMeal(state.probe);});
$('probe-meal').onclick=perform(()=>{state.probe=startProbeMeal(state.probe,tables);});
$('probe-advance').onclick=perform(()=>{state.probe=advancePrologueProbe(state.probe,150,tables);});
$('probe-after').onclick=perform(()=>{state.probe=advancePrologueProbe(state.probe,3752-state.probe.frame,tables);});
$('probe-end').onclick=perform(()=>{state.probe=advancePrologueProbe(state.probe,5550-state.probe.frame,tables);});
$('probe-late').onclick=perform(()=>{state.probe=advancePrologueProbe(state.probe,6751-state.probe.frame,tables);});
$('probe-chips').onclick=perform(()=>{state.probe=startProbeMeal(state.probe,tables,9031);});
$('probe-last').onclick=perform(()=>{state.probe=advancePrologueProbe(state.probe,7650-state.probe.frame,tables);});
$('probe-nap').onclick=perform(()=>{state.probe=startProbeNap(state.probe,tables);});
$('probe-wake').onclick=perform(()=>{let p=state.probe;while(p.nap?.status==='active')p=advancePrologueProbe(p,1,tables);state.probe=p;});
$('probe-pause').onclick=perform(()=>{state.probe={...state.probe,paused:!state.probe.paused};});
$('probe-reset').onclick=perform(()=>{state.probe=createPrologueProbe(tables);});
let dbPromise;function database(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('survival-log-rules-lab',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
$('save').onclick=perform(async()=>{const valid=validate(state),db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(valid,'manual');tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('保存失败'));});$('status').textContent='验证状态已保存。';});
$('load').onclick=perform(async()=>{const db=await database();const raw=await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('manual');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(!raw)throw Error('没有保存的验证状态');state=validate(raw);$('status').textContent='验证状态已恢复。';});
$('reset').onclick=perform(()=>{state=initial();$('status').textContent='已重置当前验证状态，保存的记录仍保留。';});
window.rulesLab={get state(){return structuredClone(state)}};render();document.querySelector("main").inert=false;
