// Closed static segment of the "Action/Sleep_6Hour" tree: Action 5 -> Effect 9 (睡觉)
// and the prologue bed Action 200 -> Effect 200 (小睡一会, observed 2026-10-21).
// Source: investigation/reports/stage2-sleep-action.md (offline disassembly only).
// Emits ordered events and attribute/buff requests; the caller owns attribute
// writeback (attributeWriteback), buff instances and the speed-up handler.
const f=Math.fround;
const DELAY_ERROR=60; // GameKey.GameTime_DelayError, RVA 0x256C815
function finite(v,k){if(!Number.isFinite(v))throw new TypeError(`Invalid ${k}`);}
export function sleepParameters(action,effect) {
 const pairs={5:9,200:200};
 if(!(action?.ID in pairs)||action.EffectConfigID!==pairs[action.ID]||effect?.ID!==action.EffectConfigID||effect.ConfigName!=='Action/Sleep_6Hour') throw new RangeError('Only Action5/Effect9 and Action200/Effect200 sleep are supported');
 for(const k of ['IntValue0','IntValue1','IntValue2','IntValue3','FloatValue0','FloatValue1','FloatValue2']) finite(effect[k],k);
 return {
  during:action.During,
  intervalInitial:effect.IntValue0,  // TestTimeCondition InitTime index0
  interval:effect.IntValue1,         // TriggerTime index1
  delayTrigger:effect.IntValue2,     // Action_DelayTrigger index2 -> event10
  completedBuffId:effect.IntValue3,  // AE_AddAttackerBuff index3
  intervalStamina:effect.FloatValue0,
  intervalStaminaCap:effect.FloatValue1,
  completedStamina:effect.FloatValue2,
  minSleepHours:3,                   // AE_TestSleepCanWake literal 0x40400000
 };
}
export function startSleepAction({action,effect,timeScale}) {
 const p=sleepParameters(action,effect);
 finite(timeScale,'timeScale');if(timeScale<=0)throw new RangeError('Invalid timeScale');
 const life=f(f(p.during)/f(timeScale));
 return {state:{actionId:action.ID,status:'active',life,remaining:life,
   intervalCd:null,delayCd:f(f(p.delayTrigger-DELAY_ERROR)/f(timeScale)),closeRequested:false,
   agentStates:['ForceCastingSpell','Sleep'],attributeHold:[...action.AttributeHold],params:p,timeScale},
  // System_Start order: FSM105, +state4, register Update20, register Delay10, TriggerSleep, +state16.
  events:['Fsm_BreakCastingSpell','AddState_ForceCastingSpell','Register_Update20','Register_Delay10','TriggerSleep','SpeedUp_Sleep_Start','AddState_Sleep']};
}
// One native BaseBtManager.UpdateNode call: update nodes run before lifetime decrement.
// applyStamina(request) must perform the caller's CostAttrValue writeback and return the
// new total Stamina; AE_TestSleepCanWake reads it after the add in the same sequence.
export function stepSleepAction(source,{deltaTime,stamina,maxStamina,applyStamina}) {
 finite(deltaTime,'deltaTime');if(deltaTime<0)throw new RangeError('Invalid delta');
 if(source.status!=='active')return {state:{...source},events:[],requests:[]};
 finite(stamina,'stamina');if(!Number.isInteger(maxStamina))throw new TypeError('maxStamina is GetTotalValue_Int');
 if(typeof applyStamina!=='function')throw new TypeError('applyStamina writeback required');
 const p=source.params,ts=source.timeScale,dt=f(deltaTime),s={...source},events=[],requests=[];
 // Delay10 has no recovered child sequence; only its dispatch is recorded.
 if(s.delayCd!==null){s.delayCd=f(s.delayCd-dt);if(s.delayCd<=0){s.delayCd=null;events.push('Delay_Trigger0');}}
 // Update20 sequence: TestTimeCondition -> AddCostAttr_Float(Stamina) -> TestSleepCanWake -> CloseBT.
 const initial=f(f(p.intervalInitial-DELAY_ERROR)/f(ts));
 let cd=f((s.intervalCd??initial)-dt);
 if(cd>0)s.intervalCd=cd;
 else {
  s.intervalCd=f(cd+f(f(p.interval)/f(ts)));
  let amount=f(p.intervalStamina);
  if(f(stamina+amount)>=f(p.intervalStaminaCap))amount=f(f(p.intervalStaminaCap)-f(stamina));
  // A non-positive amount fails AddCostAttr and stops the sequence before CanWake.
  if(amount>0){
   const request={attribute:'Stamina',amount,reason:'interval'};requests.push(request);
   const after=applyStamina(request);finite(after,'applied stamina');
   const elapsed=f(s.life-s.remaining),minLife=f(f(p.minSleepHours*3600)/f(ts));
   if(!(minLife>elapsed)&&maxStamina>0&&f(after)>=f(maxStamina-0.5)){s.closeRequested=true;events.push('CloseBT');}
  }
 }
 // UpdateNode still decrements lifetime after CloseBT; either flag ends via DeleteBt(false).
 s.remaining=f(s.remaining-dt);if(s.remaining<=0)s.closeRequested=true;
 if(s.closeRequested)return finishSleep(s,false,events,requests);
 return {state:s,events,requests};
}
export function cancelSleepAction(source) {
 if(source.status!=='active')return {state:{...source},events:[],requests:[]};
 return finishSleep({...source},true,[],[]);
}
function finishSleep(s,forceBreak,events,requests) {
 const p=s.params;
 if(!forceBreak){
  events.push('System_Completed');
  requests.push({attribute:'Stamina',amount:f(p.completedStamina),reason:'completed'});
  // Effect200 IntValue3=0: no buff was visible after the observed nap; AddBuff(0) itself is not disassembled.
  if(p.completedBuffId)requests.push({buffId:p.completedBuffId,reason:'completed'});
 }
 // System_End: -state4, FSM107, -state16, EndSleep(notify 0x2710).
 events.push('System_End','DelState_ForceCastingSpell','Fsm_EndCastingSpell','DelState_Sleep','EndSleep','SpeedUp_Sleep_End');
 return {state:{...s,status:forceBreak?'cancelled':'completed',agentStates:[],attributeHold:[],intervalCd:null,delayCd:null},events,requests};
}
