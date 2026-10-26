// Pure GuideTaskManager/listener reconstruction. Native addresses and excluded
// side effects are documented in investigation/reports/tutorial-stage2.md.
const addUnique=(list,value)=>{if(!list.includes(value))list.push(value);};
export function createTutorialCatalog(rows){
  if(!Array.isArray(rows)||!rows.length)throw new TypeError('Missing guide config');
  const ids=new Set();
  for(const row of rows){
    if(!Number.isSafeInteger(row.ID)||ids.has(row.ID)||!Number.isSafeInteger(row.GroupID)||row.GroupID<1||!Number.isSafeInteger(row.Number)||![1,2,3,5,6].includes(row.MissionType)||!Array.isArray(row.MissionValue)||row.MissionValue.length<(row.MissionType===3?2:1)||!row.MissionValue.every(Number.isSafeInteger))throw new TypeError('Unsupported or malformed guide');
    ids.add(row.ID);
  }
  return structuredClone(rows);
}

function groupRows(catalog,state){return catalog.filter(r=>r.GroupID===state.groupId);}
function updatePriority(catalog,state,effects){
  const priority=groupRows(catalog,state).filter(r=>!state.completedIds.includes(r.ID)).sort((a,b)=>a.Number-b.Number)[0];
  const id=priority?.ID??-1;
  if(state.priorityId!==id){state.priorityId=id;effects.push({type:'priorityChanged',guideId:id});if(priority?.MissionStartThink)effects.push({type:'talk',key:priority.MissionStartThink});}
}
function complete(catalog,state,row,effects){
  if(state.completedIds.includes(row.ID))return;
  state.completedIds.push(row.ID);
  state.activeIds=state.activeIds.filter(id=>id!==row.ID);
  if(row.MissionEndThink)effects.push({type:'talk',key:row.MissionEndThink});
  // Despite its field name, native OnTaskCompleted applies these tags here.
  for(const tag of row.AddTagOnMissionStart||[]){addUnique(state.tags,tag);effects.push({type:'addTag',tag});}
  effects.push({type:'taskCompleted',guideId:row.ID});
}
function satisfiedByHistory(row,state){
  const [target,threshold]=row.MissionValue;
  if(row.MissionType===1)return state.recordedFurnitureIds.includes(target);
  if(row.MissionType===2)return row.MissionValue.some(id=>state.recordedItemIds.includes(id));
  if(row.MissionType===3)return Number.isFinite(state.attributes[target])&&state.attributes[target]>=threshold;
  if(row.MissionType===5)return state.recordedActionIds.includes(target);
  return false; // StoryOpenListener has no historical replay on StartListen.
}
function enterGroups(catalog,state,effects){
  const maxGroup=Math.max(...catalog.map(r=>r.GroupID));
  while(state.groupId<=maxGroup){
    const rows=groupRows(catalog,state);
    state.activeIds=rows.filter(r=>!state.completedIds.includes(r.ID)).map(r=>r.ID);
    for(const row of rows)if(state.activeIds.includes(row.ID)&&satisfiedByHistory(row,state))complete(catalog,state,row,effects);
    updatePriority(catalog,state,effects);
    if(state.activeIds.length)return;
    if(rows.length)effects.push({type:'groupCompleted',groupId:state.groupId});
    state.groupId++;
  }
  state.completed=true;state.recording=false;state.priorityId=-1;state.activeIds=[];
  effects.push({type:'guideEnded'});
}

export function startTutorial(catalog,{attributes={}}={}){
  for(const value of Object.values(attributes))if(!Number.isFinite(value))throw new TypeError('Invalid tutorial attribute');
  const state={groupId:1,completed:false,recording:true,completedIds:[],activeIds:[],priorityId:-1,recordedActionIds:[],recordedItemIds:[],recordedFurnitureIds:[],attributes:{...attributes},tags:[]};
  const effects=[{type:'clearGuideTags',tags:[...new Set(catalog.flatMap(r=>r.AddTagOnMissionStart||[]))]}];
  enterGroups(catalog,state,effects);return {state,effects};
}

// Events carry resolved configuration identities. bagOpened.furnitureConfigId
// belongs to the original bag event's owner agent, verified as Furniture; it is
// not its targetId or the player id. actionCompleted filters to the leading role.
export function advanceTutorial(catalog,source,event){
  const types=['bagOpened','itemUsed','actionCompleted','attributeChanged','storyCompleted'];
  if(!event||!types.includes(event.type))throw new TypeError('Unknown tutorial event');
  const idKey={bagOpened:'furnitureConfigId',itemUsed:'itemConfigId',actionCompleted:'actionConfigId',attributeChanged:'attributeId',storyCompleted:'storyId'}[event.type];
  if(!Number.isSafeInteger(event[idKey]))throw new TypeError('Invalid event identity');
  if(event.type==='attributeChanged'&&!Number.isFinite(event.value))throw new TypeError('Invalid attribute value');
  const state=structuredClone(source),effects=[];
  if(!state.recording||state.completed)return {state,effects};
  if(event.type==='actionCompleted'&&event.isLeadingRole!==true)return {state,effects};
  if(event.type==='bagOpened'&&event.isFurniture!==true)return {state,effects};
  if(event.type==='bagOpened')addUnique(state.recordedFurnitureIds,event.furnitureConfigId);
  if(event.type==='itemUsed')addUnique(state.recordedItemIds,event.itemConfigId);
  if(event.type==='actionCompleted')addUnique(state.recordedActionIds,event.actionConfigId);
  if(event.type==='attributeChanged')state.attributes[event.attributeId]=event.value;
  // Snapshot listeners: newly entered groups use history/current attributes,
  // rather than receiving the same story event retroactively.
  for(const row of groupRows(catalog,state).filter(r=>state.activeIds.includes(r.ID))){
    const [target,threshold]=row.MissionValue;
    const matches=(row.MissionType===1&&event.type==='bagOpened'&&target===event.furnitureConfigId)||
      (row.MissionType===2&&event.type==='itemUsed'&&row.MissionValue.includes(event.itemConfigId))||
      (row.MissionType===3&&event.type==='attributeChanged'&&target===event.attributeId&&event.value>=threshold)||
      (row.MissionType===5&&event.type==='actionCompleted'&&target===event.actionConfigId)||
      (row.MissionType===6&&event.type==='storyCompleted'&&target===event.storyId);
    if(matches)complete(catalog,state,row,effects);
  }
  updatePriority(catalog,state,effects);
  if(!state.activeIds.length){effects.push({type:'groupCompleted',groupId:state.groupId});state.groupId++;enterGroups(catalog,state,effects);}
  return {state,effects};
}

export function tutorialRows(catalog,state){
  if(state.completed)return [];
  return groupRows(catalog,state).sort((a,b)=>a.Number-b.Number).map(r=>({id:r.ID,text:r.GuideText_Local,completed:state.completedIds.includes(r.ID),priority:r.ID===state.priorityId}));
}
