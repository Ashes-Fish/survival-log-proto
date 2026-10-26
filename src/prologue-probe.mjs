// Integration probe, not a complete world simulation. Fixed observation scope:
// chapter 0 / standard difficulty / unsuppressed infection + hunger, first 8h30m.
// Native component order and other passive effects remain unverified.
import {createGameClock,tickGameClock,clockReading,toInternalTime} from './game-clock.mjs';
import {recoveryTick} from './attribute-recovery.mjs';
import {attributeWriteback} from './attribute-writeback.mjs';
import {thresholdPassiveEvent,buffIntervalTick,prologueBuffModifiers,prologueBuffIntervalRequests} from './prologue-buffs.mjs';
import {startFoodAction,stepFoodAction,cancelFoodAction,consumeCompletedFood} from './food-action.mjs';
import {createPrologueWardrobe} from './prologue-wardrobe.mjs';
import {createTutorialCatalog,startTutorial,advanceTutorial} from './tutorial.mjs';
import {startSleepAction,stepSleepAction} from './sleep-action.mjs';
const f=Math.fround;
const attributes=['Satiety','Morale','Stamina','Health','Vitality'];
export const PROBE_COVERAGE={kind:'component-integration-probe',frameStep:1/30,maximumFrames:7650,
  recovered:['chapter-0 base attributes','recovery countdowns','fixed-point writeback','hunger predicates','two Buff_Default instances','fatigue and dying status modifiers','clock arithmetic','configured wardrobe stock and packing','tuna/chips completion and cancellation','tutorial listeners','prologue bed nap Action200 and sleep temp speed-up (SleepSpeedStart, SpeedUp2)'],
  provisional:['component execution order','nap step placed after meal step','nap CostAttr source type (only Item=2 changes writeback)','speed-up scale applied from the frame after it is set','initial cooldown phase relative to opening timeline','standard resolved ratios'],
  absent:['world initialization','movement','other passive effects','full food action graph','native save compatibility']};
const row=(tables,name,id)=>{const r=tables[name]?.find(r=>r.ID===id);if(!r)throw Error(`Missing ${name} ${id}`);return r;};
export function createPrologueProbe(tables){
  const attr=row(tables,'PlayAttribute',4),chapter=row(tables,'Chapter',0),effects=tables.Effect;
  if(chapter.TimeScale!==120||chapter.WorldStateType!==2)throw Error('Unsupported chapter');
  prologueBuffModifiers([1001,1112],effects);
  const wardrobe=createPrologueWardrobe(tables),catalog=createTutorialCatalog(tables.Guide);
  return {schema:4,kind:'survival-log-prologue-probe',frame:0,paused:false,
    clock:createGameClock({timerKind:'countUp',gameSeconds:0,day:0,toolsetTimeScale:chapter.TimeScale,started:true,battleScale:1}),
    values:Object.fromEntries(attributes.map(a=>[a,attr[a]])),
    recovery:Object.fromEntries(attributes.map(a=>[a,{attribute:a,cd:toInternalTime(attr['Interval'+a],chapter.TimeScale)}])),
    hunger:{present:false,removalCd:null},fatigue:{present:false,removalCd:null},dying:{present:false,removalCd:null},buffTimers:{1001:{cd:null},1112:{cd:null}},
    wardrobe:wardrobe.items,wardrobeSource:wardrobe.provenance,
    tutorial:startTutorial(catalog,{attributes:{1:attr.Satiety,3:attr.Stamina}}).state,
    meal:null,nap:null,speed:{scale:1,beforeScale:-1,pendingAt:-1},commands:[],events:[],coverage:structuredClone(PROBE_COVERAGE)};
}
function guide(state,event,tables){const result=advanceTutorial(tables.Guide,state.tutorial,event);state.tutorial=result.state;for(const effect of result.effects)record(state,{type:'tutorial',effect});}
function command(state,type){if(state.commands.length>=64)throw Error('本次对照最多记录64条操作');state.commands.push({frame:state.frame,type});}
// Room-side action completions (obstacle 202, door 203). Kept separate from the
// fixed story/wardrobe events so existing probe records keep their semantics.
export function probeActionEvent(source,actionConfigId,tables){
  if(source.paused)throw Error('请先继续对照');
  if(![202,203].includes(actionConfigId))throw Error('Unsupported probe action event');
  const state=structuredClone(source);command(state,'action-'+actionConfigId);
  guide(state,{type:'actionCompleted',actionConfigId,isLeadingRole:true},tables);return state;
}

export function probeTutorialEvent(source,type,tables){
  if(source.paused)throw Error('请先继续对照');
  const events={story:{type:'storyCompleted',storyId:1501},wardrobe:{type:'bagOpened',furnitureConfigId:9111,isFurniture:true}};
  if(!events[type])throw Error('Unsupported probe tutorial event');
  const state=structuredClone(source);command(state,type);guide(state,events[type],tables);return state;
}
// Unity deltaTime for one 1/30 s frame; the scale set during frame N applies from N+1.
function frameDelta(state){return f(f(1/30)*f(state.speed.scale));}
function held(state,attribute){const id=attributes.indexOf(attribute)+1;return [state.meal,state.nap].some(a=>a?.status==='active'&&a.attributeHold.includes(id));}
function active(state){return [1112,...(state.hunger.present?[1001]:[]),...(state.fatigue.present?[1004]:[]),...(state.dying.present?[1007]:[])];}
function record(state,event){state.events.push({frame:state.frame,...event});if(state.events.length>150)state.events.shift();}
function transition(state,event,tables,attribute,dt=frameDelta(state)){
  for(const [key,attr,id] of [['hunger','Satiety',200010001],['fatigue','Stamina',200010004],['dying','Vitality',200010007]]){
    if(event==='attribute-change'&&attr!==attribute)continue;
    const result=thresholdPassiveEvent(state[key],{event,value:state.values[attr],passiveEffect:row(tables,'Effect',id),deltaTime:dt,timeScale:120});
    state[key]={present:result.present,removalCd:result.removalCd};
    if(result.transition){if(key==='hunger')state.buffTimers[1001]={cd:null};record(state,{type:key,action:result.transition.type,buffId:result.transition.buffId});}
  }
}
function write(state,request,tables){
  const attr=row(tables,'PlayAttribute',4),mod=prologueBuffModifiers(active(state),tables.Effect);
  const {attribute,amount,sourceType=0}=request;
  const result=attributeWriteback({attribute,current:state.values[attribute],amount,maximum:attr['Max'+attribute]+mod.maxima[attribute],costRatio:amount>0?mod.addRatios[attribute]:mod.delRatios[attribute],sourceType,foodSubCategory:request.foodSubCategory??0,isLeadingRole:true});
  state.values[attribute]=result.value;
  if(!result.ignored)guide(state,{type:'attributeChanged',attributeId:attributes.indexOf(attribute)+1,value:result.value},tables);
  if(!result.ignored){record(state,{type:'attribute',attribute,sourceType,amount:result.appliedDelta,value:result.value});transition(state,'attribute-change',tables,attribute);}
}
export function probeReading(state,tables){
  const attr=row(tables,'PlayAttribute',4),mod=prologueBuffModifiers(active(state),tables.Effect);
  return {...clockReading(state.clock),speedScale:state.speed.scale,nap:state.nap?.status??null,attributes:Object.fromEntries(attributes.map(a=>[a,{value:state.values[a],maximum:attr['Max'+a]+mod.maxima[a]}])),hunger:state.hunger.present,meal:state.meal};
}
export function advancePrologueProbe(source,frames,tables){
  if(!Number.isSafeInteger(frames)||frames<0||frames>PROBE_COVERAGE.maximumFrames)throw RangeError('Invalid probe frame count');
  if(source.paused)return structuredClone(source);
  if(source.frame+frames>PROBE_COVERAGE.maximumFrames)throw RangeError('超出本次对照的帧数范围（常速8小时30分）。请重置对照。');
  const state=structuredClone(source),attr=row(tables,'PlayAttribute',4);
  for(let n=0;n<frames;n++){
    state.frame++;
    const dt=frameDelta(state);
    state.clock=tickGameClock(state.clock,{deltaTime:dt,unscaledDeltaTime:1/30}).clock;
    // GameTimeManager.Update 0x26139A1: a pending sleep speed-up fires once total seconds reach it.
    if(state.speed.pendingAt>=0&&clockReading(state.clock).totalSeconds>=state.speed.pendingAt){
      const scale=row(tables,'Chapter',0).SpeedUp2;
      state.speed={scale,beforeScale:state.speed.beforeScale<0?state.speed.scale:state.speed.beforeScale,pendingAt:-1};record(state,{type:'speed-up',scale});
    }
    for(const attribute of attributes){
      const mod=prologueBuffModifiers(active(state),tables.Effect);
      const tick=recoveryTick(state.recovery[attribute],{worldState:2,deltaTime:dt,timeScale:120,current:state.values[attribute],target:attr['Target'+attribute],interval:attr['Interval'+attribute],addRatio:mod.addRatios[attribute],delRatio:mod.delRatios[attribute],blockDecrease:held(state,attribute),isLeadingRole:true});
      state.recovery[attribute]={attribute,cd:tick.cd};
      if(tick.request)write(state,{...tick.request,sourceType:3},tables);
    }
    for(const id of active(state)){
      if(id===1004||id===1007)continue;
      const effect=row(tables,'Effect',200000000+id),timer=buffIntervalTick(state.buffTimers[id],{intervalSeconds:effect.BuffInterval,deltaTime:dt,timeScale:120});
      state.buffTimers[id]={cd:timer.cd};
      if(timer.trigger)for(const request of prologueBuffIntervalRequests(effect))write(state,request,tables);
    }
    if(state.meal?.status==='active'){
      const step=stepFoodAction(state.meal,dt);state.meal=step.state;
      if(step.events.includes('System_Completed')){
        const instance=state.wardrobe.find(i=>i.instanceId===state.meal.itemInstanceId);
        const item=row(tables,'Item',instance.configId),action=row(tables,'Action',item.UseAction),effect=row(tables,'Effect',action.EffectConfigID);
        write(state,{attribute:'Satiety',amount:effect.ItemSatietyEnd,sourceType:2,foodSubCategory:item.SubCategory},tables);
        const consumed=consumeCompletedFood(state.meal,state.wardrobe.find(i=>i.instanceId===state.meal.itemInstanceId));
        state.wardrobe=state.wardrobe.filter(i=>i.instanceId!==consumed.instanceId);
        guide(state,{type:'itemUsed',itemConfigId:item.ID},tables);
        guide(state,{type:'actionCompleted',actionConfigId:action.ID,isLeadingRole:true},tables);
        record(state,{type:'meal-completed',configId:item.ID});
      }
    }
    if(state.nap?.status==='active')stepNap(state,dt,tables);
    transition(state,'update',tables,undefined,dt);
  }
  return state;
}
function stepNap(state,dt,tables){
  const attr=row(tables,'PlayAttribute',4),mod=prologueBuffModifiers(active(state),tables.Effect);
  // AE_AddCostAttr_Float -> CostAttrValue; DetermineSourceType result assumed Action(5), see coverage.provisional.
  const apply=request=>{write(state,{attribute:'Stamina',amount:request.amount,sourceType:5},tables);return state.values.Stamina;};
  const step=stepSleepAction(state.nap,{deltaTime:dt,stamina:state.values.Stamina,maxStamina:attr.MaxStamina+mod.maxima.Stamina,applyStamina:apply});
  state.nap=step.state;
  for(const request of step.requests)if(request.reason==='completed')apply(request);
  if(step.events.includes('SpeedUp_Sleep_End'))endSpeedUp(state);
  if(step.events.includes('System_Completed')){
    guide(state,{type:'actionCompleted',actionConfigId:state.nap.actionId,isLeadingRole:true},tables);
    record(state,{type:'nap-completed',actionId:state.nap.actionId});
  }
}
// GameTimeManager.CancelTempSpeedUp 0x26110A0: restore the saved scale and clear the pending trigger.
function endSpeedUp(state){state.speed={scale:state.speed.beforeScale>=0?state.speed.beforeScale:state.speed.scale,beforeScale:-1,pendingAt:-1};}
export function startProbeNap(source,tables){
  if(source.paused||source.meal?.status==='active'||source.nap?.status==='active')throw Error('当前不能开始睡觉对照');
  const func=row(tables,'FurnitureFunc',400),action=row(tables,'Action',func.ActionIds[0]),effect=row(tables,'Effect',action.EffectConfigID),chapter=row(tables,'Chapter',0);
  if(func.ActionIds.length!==1||action.ID!==200)throw Error('Unsupported bed configuration');
  const state=structuredClone(source),start=startSleepAction({action,effect,timeScale:chapter.TimeScale});
  state.nap=start.state;
  // AE_TriggerSleep -> StartTempSpeedUp(Sleep) 0x2613220: trigger at total seconds + Chapter.SleepSpeedStart.
  if(state.speed.pendingAt<0)state.speed={...state.speed,pendingAt:clockReading(state.clock).totalSeconds+chapter.SleepSpeedStart};
  command(state,'nap-start');record(state,{type:'nap-started',actionId:action.ID});return state;
}
export function startProbeMeal(source,tables,configId=9030){
  if(source.paused||source.nap?.status==='active'||source.meal?.status==='active'||!source.wardrobe.some(i=>i.configId===configId))throw Error('当前不能开始这次进食对照');
  const item=row(tables,'Item',configId),action=row(tables,'Action',item.UseAction),effect=row(tables,'Effect',action.EffectConfigID);
  if(![9030,9031].includes(configId)||action.During!==600||effect.ConfigName!=='Action/Item_Bar_Default'||effect.ItemSatietyEnd!==(configId===9030?20:10)||item.UseTimes!==1)throw Error('Unsupported meal configuration');
  const state=structuredClone(source);
  state.meal=startFoodAction({itemInstanceId:state.wardrobe.find(i=>i.configId===configId).instanceId,action,timeScale:120});
  command(state,configId===9030?'meal-start':'chips-start');
  record(state,{type:'meal-started',configId});return state;
}
export function cancelProbeMeal(source){
  if(source.paused||source.meal?.status!=='active')throw Error('当前没有可取消的进食');
  const state=structuredClone(source);state.meal=cancelFoodAction(state.meal).state;command(state,'meal-cancel');record(state,{type:'meal-cancelled',configId:state.meal.actionId-100000000});return state;
}
export function validatePrologueProbe(raw,tables){
  if(!raw||raw.kind!=='survival-log-prologue-probe'||raw.schema!==4||!Number.isSafeInteger(raw.frame)||raw.frame<0||raw.frame>PROBE_COVERAGE.maximumFrames||typeof raw.paused!=='boolean')throw Error('验证状态版本不兼容或格式错误；旧记录未改写，请重置当前对照');
  // Replay a bounded command log; events may be truncated without losing inputs.
  if(!Array.isArray(raw.events)||raw.events.length>150)throw Error('Invalid probe trace');
  if(!Array.isArray(raw.commands)||raw.commands.length>64)throw Error('Invalid command trace');
  let expected=createPrologueProbe(tables);
  for(const c of raw.commands){
    if(!Number.isSafeInteger(c.frame)||c.frame<expected.frame||c.frame>raw.frame)throw Error('Invalid command time');
    expected=advancePrologueProbe(expected,c.frame-expected.frame,tables);
    if(c.type==='meal-start')expected=startProbeMeal(expected,tables);
    else if(c.type==='chips-start')expected=startProbeMeal(expected,tables,9031);
    else if(c.type==='nap-start')expected=startProbeNap(expected,tables);
    else if(c.type==='meal-cancel')expected=cancelProbeMeal(expected);
    else expected=probeTutorialEvent(expected,c.type,tables);
  }
  expected=advancePrologueProbe(expected,raw.frame-expected.frame,tables);
  expected.paused=raw.paused;
  if(JSON.stringify(raw)!==JSON.stringify(expected))throw Error('对照存档与支持的事件链不一致');
  return expected;
}
