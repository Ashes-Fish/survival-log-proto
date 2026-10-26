import {createSession,changeInventory,validateSession} from './inventory.mjs';
import {saveSession,loadSession} from './storage.mjs';
import {createDifficultyCatalog,createDifficultySelection,difficultyMessages,difficultySelectionMessage,reduceDifficulty,difficultyPagePath} from './difficulty.mjs';
import {resolveNewGame} from './new-game.mjs';

const $=id=>document.getElementById(id);
const pagePaths={MainUI:'MainUI/MainUI.html',SelectPeople:'SelectPeople/SelectPeople.html',Backpack:'BackpackUI/BackpackUI.html',SelectMenu:'SelectMenu/SelectMenu.html'};
const pages=new Map();let state=null,saved=null,dual=false,preview=false,menuItem=null,toastTimer,dirty=false;
const trace=[]; // Bounded trace for browser QA and later comparison; no original game state.
let characters=[],pendingStart=null,difficultyCatalog=null,difficultySelection=null,initialization=null;
async function config(name){const r=await fetch(`/data/Config_${name}.json`);if(!r.ok)throw new Error(`缺少原版配置 ${name}`);return r.json();}
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function send(id,type,data={}){const p=pages.get(id);if(!p)return;p.frame.contentWindow.postMessage({type,data},location.origin);trace.push({direction:'in',page:id,type});if(trace.length>200)trace.shift();}
function closePage(id){pages.get(id)?.frame.remove();pages.delete(id);}
function clearPages(){for(const id of [...pages.keys()])closePage(id);}
async function openPage(id,path=pagePaths[id],z=10){
  closePage(id);const frame=document.createElement('iframe');frame.title=id;frame.style.zIndex=z;
  const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`${id} 页面未就绪`)),15000);pages.set(id,{frame,resolve:()=>{clearTimeout(timer);resolve();}});});
  frame.src='/WebUI/UI/'+path;$('pages').append(frame);await ready;return frame;
}
function renderSession(){
  $('session-name').textContent=state?.character||'';
  $('summary').textContent=state?`背包 ${state.items.filter(i=>i.ownerId===1).length} 组物资 · 储物箱 ${state.items.filter(i=>i.ownerId===2).length} 组物资 · ${dirty?'有未保存操作':'已保存'}`:'';
  $('journal').replaceChildren(...(state?.journal||[]).map(s=>{const li=document.createElement('li');li.textContent=s;return li;}));
}
async function main(){
  $('initialization').hidden=true;
  clearPages();$('session').hidden=true;preview=false;$('preview-bar').hidden=true;
  try{saved=await loadSession();}catch(e){toast('无法读取浏览器存档：'+e.message);}
  await openPage('MainUI');
  send('MainUI','WebUI_MainUI_VersionMsg',{version:'1.1.18599 · Web 移植验证版',showContinue:!!saved,showReadSave:!!saved,endlessUnlocked:false,continueSummary:saved?'网页验证进度':'',flavorText:'收音机里说，最近的天气有点不对劲。'});
  send('MainUI','WebUI_MainUI_LocalizationMsg',{continueText:'继续生存',newGameText:'新生存',pureEndlessText:'无尽模式',loadGameText:'读取存档',settingsText:'设置',exitText:'退出',footerText:'网页移植开发版 · 当前可验证原版界面、背包操作与浏览器存档',settingsTitle:'设置',settingsClose:'关闭',confirmTitle:'开始新的验证场景',confirmLine1:'当前网页版本使用测试物资。',confirmLine3:'已保存的进度会保留到下次手动保存。',confirmCancel:'返回',confirmOk:'开始'});
  send('MainUI','WebUI_MainUI_EnterFxMsg',{replaySeq:1});
}
async function chooseCharacter(){
  const response=await fetch('/data/Config_PlayerSelect.json');
  if(!response.ok)throw new Error('原版角色配置尚未生成。');
  characters=await response.json();
  clearPages();await openPage('SelectPeople');
  send('SelectPeople','WebUI_SelectPeople_DataMsg',{selectedIndex:0,playerList:characters.map(c=>({name:c.Name_Local,des1:c.Des1_Local,des2:c.Des2_Local,npcPic:c.NpcPic,bgPic:c.BgPic,isLocked:!c.IsUnlocked,unlockHint:c.UnlockHint_Local,showSkipTutorial:false,showSkipOpening:false}))});
  send('SelectPeople','WebUI_SelectPeople_LocalizationMsg',{startGameText:'开始生存',backToMainText:'返回开始菜单',traitsTitle:'特质'});
}
async function chooseDifficulty(data){
  const index=data.index;
  if(!Number.isInteger(index)||!characters[index]||!characters[index].IsUnlocked)throw new Error('此角色尚未解锁。');
  pendingStart={playerSelectId:characters[index].ID,skipTutorial:data.skipTutorial===true,skipOpening:data.skipOpening===true};
  const [presets,params]=await Promise.all([config('DifficultyPreset'),config('DifficultyParam')]);
  difficultyCatalog=createDifficultyCatalog(presets,params);difficultySelection=createDifficultySelection(difficultyCatalog);
  clearPages();await openPage('DifficultySelect',difficultyPagePath);
  // Original paths resolve relative to the original page; preserve its resolver.
  for(const msg of difficultyMessages(difficultyCatalog,difficultySelection,{bgPic:characters[index].BgPic,localization:{confirmBtnText:'开始生存',backBtnText:'返回',resetBtnText:'恢复默认'}}))send('DifficultySelect',msg.type,msg.data);
}
async function confirmInitialization(){
  const tables={};await Promise.all(['PlayerSelect','Player','PlayAttribute','Chapter','Bag','GlobalSetting','DifficultyParam'].map(async n=>{tables[n]=await config(n);}));
  initialization=resolveNewGame(tables,{...pendingStart,difficulty:difficultySelection});
  clearPages();$('session').hidden=true;$('initialization').hidden=false;
  $('init-heading').textContent=`${initialization.character} · ${initialization.skipTutorial?'备灾开局':'序章开局'}`;
  $('init-summary').textContent=`章节 ${initialization.chapterId} · 角色配置 ${initialization.playerId} · 地图 ${initialization.mapId} · ${initialization.scene}`;
  $('init-attributes').replaceChildren(...Object.entries(initialization.baseAttributes).map(([name,a])=>{const row=document.createElement('tr');for(const value of [name,a.value,a.maximum,a.interval,a.target]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;}));
  $('init-details').textContent=`配置背包 ${initialization.bag.cols}×${initialization.bag.rows}，负重参数 ${initialization.bag.burden}；章节时间倍率 ${initialization.configuredTimeScale}；默认 Buff：${initialization.configuredBuffs.join('、')}。`;
  $('init-json').textContent=JSON.stringify(initialization,null,2);
}
function enterSession(data){state=validateSession(data);clearPages();$('session').hidden=false;preview=false;$('preview-bar').hidden=true;renderSession();}
const bagText={toSelfText:'拿取全部',toOtherText:'存入全部',weightLabel:'负重',sortBackpackText:'整理背包',discardAllText:'全部丢弃',singleBagHintText:'左键查看 · 拖动整理',dualBagHintText:'Shift + 点击转移物品',quickUseHintText:'',shelfLifeLabel:'保质期',dropKeyName:'Q',dropHintText:'',transferCategoryToSelfText:'拿取同类',transferCategoryToOtherText:'存入同类'};
function updateBag(){
  if(!state||!pages.has('Backpack'))return;
  state.bags.forEach((b,index)=>{const side=index===0?'A':'B';send('Backpack',`WebUI_Backpack_Info${side}Msg`,{backpackName:b.name,ownerId:b.ownerId,gridCols:b.cols,gridRows:b.rows,currentWeight:0,maxWeight:0,overweightLine:0,bagTips:'测试物资 · 重量与原生效果待恢复',bagTipsColor:'#c7b785',isDualBag:dual,isPrologue:false,canDiscardAll:false});send('Backpack',`WebUI_Backpack_Items${side}Msg`,{itemsJson:JSON.stringify(state.items.filter(i=>i.ownerId===b.ownerId).map(i=>({...i,kindName:i.name,kin:i.name,category:0,canQuickUse:false})))});});
  send('Backpack','WebUI_Backpack_LocalizationMsg',bagText);
}
async function openBag(withStorage=false){if(!state){toast('请先从“新生存”进入验证场景。');return;}dual=withStorage;closePage('SelectMenu');await openPage('Backpack');updateBag();}
function apply(action){const result=changeInventory(state,action);if(!result.ok){toast(result.error);updateBag();return;}state=result.state;dirty=true;renderSession();updateBag();}
async function itemMenu(data){
  menuItem=state.items.find(i=>i.id===data.itemId);if(!menuItem)return;
  await openPage('SelectMenu',pagePaths.SelectMenu,30);
  send('SelectMenu','WebUI_SelectMenu_MenuMsg',{btnList:[{text:menuItem.name,isLocked:false,tips:`数量 ${menuItem.count} · 测试物资`},{text:menuItem.ownerId===1?'移入储物箱':'放入背包',isLocked:false},{text:'关闭',isLocked:false}]});
  const x=Number(data.rectX)||innerWidth*.5,y=Number(data.rectY)||innerHeight*.5;
  send('SelectMenu','WebUI_SelectMenu_PositionMsg',{posX:Math.max(.12,Math.min(.85,x/innerWidth)),posY:Math.max(.15,Math.min(.8,y/innerHeight))});
}
async function save(){if(!state){toast('还没有可保存的进度。');return;}await saveSession(state);saved=await loadSession();dirty=false;renderSession();toast('进度已保存到此浏览器。');}
async function restore(){const result=await loadSession();if(!result){toast('还没有浏览器存档。');return;}saved=result;dirty=false;enterSession(result.state);toast('已读取保存的进度。');}
async function onEvent(page,type,data){
  if(preview){if(['CLOSE','ACTION_CLOSE','BACK_TO_MAIN'].includes(type))await endPreview();return;}
  if(type.startsWith('__')||/SFX_|SOUND|HOVER|VIEW_NEW_UNLOCK/.test(type))return;
  if(page==='MainUI'){
    if(type==='NEW_GAME'||type==='NEW_GAME_CONFIRM')return chooseCharacter();
    if(type==='CONTINUE'||type==='LOAD_SAVE')return restore();
    if(type==='LOAD_GAME'){const result=await loadSession();send(page,'WebUI_MainUI_SaveListMsg',{isShow:true,saveList:result?[{Index:0,phase:0,phaseText:'网页验证',timeText:new Date(result.savedAt).toLocaleString(),roleText:result.state.character,info1:`${result.state.items.length} 组物资 · ${result.state.revision} 次操作`}]:[]});return;}
    if(type==='CLOSE_SAVE'){send(page,'WebUI_MainUI_SaveListMsg',{isShow:false});return;}
    if(type==='SETTINGS'){send(page,'WebUI_MainUI_SettingsMsg',{isShow:true,bgVolume:0,actionVolume:0,ambientVolume:0,resolutions:'1920x1080,1280x720',resolution:'1920x1080',currentLanguage:'zh-CN'});return;}
    if(type==='CLOSE_SETTINGS'){send(page,'WebUI_MainUI_SettingsMsg',{isShow:false});return;}
    if(type==='EXIT'){toast('可以直接关闭此浏览器标签页。');return;}
  }
  if(page==='SelectPeople'){
    if(type==='BACK_TO_MAIN')return main();
    if(type==='START_GAME')return chooseDifficulty(data);
  }
  if(page==='DifficultySelect'){
    if(type==='CLOSE')return chooseCharacter();
    if(type==='CONFIRM')return confirmInitialization();
    if(type==='SELECT_PRESET'||type==='SET_PARAM'){
      const result=reduceDifficulty(difficultyCatalog,difficultySelection,type,data);
      if(!result.ok)throw new Error(result.error);
      difficultySelection=result.selection;
      const msg=difficultySelectionMessage(difficultyCatalog,difficultySelection);send(page,msg.type,msg.data);return;
    }
  }
  if(page==='Backpack'&&state){
    if(type==='ACTION_CLOSE'){closePage('SelectMenu');closePage('Backpack');return;}
    if(type==='CLICK_ITEM')return itemMenu(data);
    if(type==='DRAG_ITEM')return apply({type:'move',itemId:data.itemId,ownerId:data.dstOwnerId,x:data.x,y:data.y});
    if(type==='SORT_BACKPACK')return apply({type:'sort',ownerId:data.side==='B'?2:1});
    if(type==='QUICK_TRANSFER_ITEM'||type==='QUICK_TRANSFER_KIND'){const i=state.items.find(i=>i.id===data.itemId);if(i)return apply({type:'transfer',itemId:i.id,ownerId:i.ownerId===1?2:1});}
    if(type==='TRANSFER_TO_SELF'||type==='TRANSFER_TO_OTHER'){const dest=type==='TRANSFER_TO_SELF'?1:2;for(const item of [...state.items].filter(i=>i.ownerId!==dest))apply({type:'transfer',itemId:item.id,ownerId:dest});return;}
  }
  if(page==='SelectMenu'){
    if(type==='CLOSE'){closePage('SelectMenu');return;}
    if(type==='BTN_CLICK'){if(data.index===1&&menuItem)apply({type:'transfer',itemId:menuItem.id,ownerId:menuItem.ownerId===1?2:1});else if(data.index===0&&menuItem)toast(`${menuItem.name} × ${menuItem.count}。原版使用效果仍在恢复中。`);closePage('SelectMenu');return;}
  }
  toast('此功能的原生逻辑仍在恢复中。');
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  const entry=[...pages.entries()].find(([,p])=>p.frame.contentWindow===event.source);if(!entry)return;
  const [id,p]=entry,m=event.data;if(!m||typeof m.type!=='string')return;
  if(m.type==='__PAGE_READY__'){p.resolve();return;}
  trace.push({direction:'out',page:id,type:m.type});if(trace.length>200)trace.shift();
  let data=m.data??{};if(typeof data==='string'){try{data=JSON.parse(data);}catch{return;}}
  Promise.resolve(onEvent(id,m.type,data)).catch(e=>{console.error(e);toast(e.message);});
});
async function endPreview(){preview=false;$('preview-bar').hidden=true;clearPages();if(state){$('session').hidden=false;renderSession();}else await main();}
async function showCatalog(){const list=await fetch('/src/pages.json').then(r=>r.json());const render=()=>{$('catalog-list').replaceChildren(...list.filter(p=>p.path.toLowerCase().includes($('page-search').value.toLowerCase())).map(p=>{const button=document.createElement('button');button.textContent=p.name;button.onclick=async()=>{$('catalog-dialog').close();clearPages();$('session').hidden=true;preview=true;$('preview-bar').hidden=false;$('preview-title').textContent=p.name;try{await openPage('Preview',p.path);}catch(e){toast(e.message)}};return button;}));};$('page-search').oninput=render;render();$('catalog-dialog').showModal();}
function bind(id,fn){$(id).onclick=()=>Promise.resolve(fn()).catch(e=>{console.error(e);toast(e.message);});}
bind('menu',main);bind('bag',()=>openBag());bind('store',()=>openBag(true));bind('save',save);bind('restore',restore);bind('catalog-button',showCatalog);bind('catalog-close',()=>$('catalog-dialog').close());bind('preview-close',endPreview);
bind('init-menu',main);
bind('fixture',()=>{$('initialization').hidden=true;dirty=true;enterSession(createSession());return openBag();});
bind('export',()=>{if(!state){toast('请先开始或读取进度。');return;}const blob=new Blob([JSON.stringify(validateSession(state),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='survival-log-web-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
bind('import',()=>$('import-file').click());$('import-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>1_000_000)throw new Error('存档文件过大。');const valid=validateSession(JSON.parse(await f.text()));enterSession(valid);dirty=true;renderSession();toast('存档已载入，点击“保存进度”可写入浏览器。');}catch(error){toast(error.message);}finally{e.target.value='';}};
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(pages.has('SelectMenu'))closePage('SelectMenu');else closePage('Backpack');}if(e.key.toLowerCase()==='b'&&state&&!preview&&!$('catalog-dialog').open)openBag().catch(e=>toast(e.message));});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
// Read-only diagnostics for automated verification. Mutations go through real UI messages.
window.reconstruction={get state(){return state?structuredClone(state):null},get initialization(){return initialization?structuredClone(initialization):null},get trace(){return structuredClone(trace)},get pages(){return [...pages.keys()]}};
main().catch(e=>{console.error(e);toast('启动失败：'+e.message);});
