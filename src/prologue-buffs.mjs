// Focused static reconstruction for installed 1.1.18599 only.
// See investigation/reports/stage2-prologue-buffs.md for native addresses/limits.
const f = Math.fround;
const names = ['Satiety','Morale','Stamina','Health','Vitality'];
function finite(value, name) { if (!Number.isFinite(value)) throw new TypeError(`Invalid ${name}`); }

// Events preserve the native distinction: adding follows a matching attribute change;
// removal is evaluated on Update_Trigger0, not in the add callback.
export function thresholdPassiveEvent(source, {event, value, passiveEffect, deltaTime=0, timeScale=1}) {
  finite(value,'value'); finite(deltaTime,'deltaTime'); finite(timeScale,'timeScale');
  const supported={200010001:'Buff/Passive_Hunger',200010004:'Buff/Passive_Fatigue',200010007:'Buff/Passive_Dying'};
  if (deltaTime<0 || timeScale<=0 || !passiveEffect || !supported[passiveEffect.ID] || passiveEffect.ConfigName!==supported[passiveEffect.ID]) throw new RangeError('Unsupported threshold passive context');
  for (const key of ['IntValue0','IntValue1','IntValue2','IntValue3']) finite(passiveEffect[key], key);
  if (typeof source.present!=='boolean' || (source.removalCd!==null&&!Number.isFinite(source.removalCd))) throw new TypeError('Invalid hunger state');
  const result={...source,transition:null};
  if(event==='attribute-change') {
    if(!source.present && value<=passiveEffect.IntValue1) {result.present=true;result.transition={type:'add',buffId:passiveEffect.IntValue0};}
    return result;
  }
  if(event!=='update') throw new RangeError('Unsupported hunger event');
  if(!source.present || value<passiveEffect.IntValue2) {result.removalCd=null;return result;}
  // Action_TestTimeCondition reads IntValue3, not the literal slot number 3.
  const initial=f(f(passiveEffect.IntValue3-60)/f(timeScale));
  const cd=f((source.removalCd??initial)-f(deltaTime));
  if(cd>0) return {...result,removalCd:cd};
  return {...result,present:false,removalCd:f(cd+f(passiveEffect.IntValue3/timeScale)),transition:{type:'remove',buffId:passiveEffect.IntValue0}};
}

// AE_BuffTestInterval stores a full interval initially and retains overshoot.
// Exactly one trigger per call, matching native per-update behavior.
export function buffIntervalTick(source, {intervalSeconds,deltaTime,timeScale}) {
  for(const [k,v] of Object.entries({intervalSeconds,deltaTime,timeScale})) finite(v,k);
  if(deltaTime<0||timeScale<=0) throw new RangeError('Invalid buff clock');
  if(source.cd!==null&&!Number.isFinite(source.cd)) throw new TypeError('Invalid buff countdown');
  if(intervalSeconds<=0) return {...source,trigger:false};
  const interval=f(f(intervalSeconds)/f(timeScale));
  const cd=f((source.cd??interval)-f(deltaTime));
  return {cd:cd<=0?f(cd+interval):cd,trigger:cd<=0};
}

// Two Buff_Default instances plus independently owned fatigue/dying modifiers.
// Returned modifiers are inputs to the caller's existing attribute resolver.
export function prologueBuffModifiers(activeBuffIds, effects) {
  const maxima={},addRatios={},delRatios={};
  for(const id of new Set(activeBuffIds)) {
    if(![1001,1004,1007,1112].includes(id)) throw new RangeError('Unsupported prologue buff');
    const e=effects.find(e=>e.ID===200000000+id);
    if(id===1004||id===1007){
      if(!e||e.ConfigName!==(id===1004?'Buff/Child_Fatigue':'Buff/Child_Dying'))throw new TypeError('Missing weakness effect');
      const keys=id===1004?['Satiety','Morale','Health','Vitality']:['Satiety','Morale','Stamina','Health'];
      keys.forEach((name,index)=>{const v=e[`FloatValue${index}`];finite(v,name);addRatios[name]=f((addRatios[name]??0)+v);});
      if(id===1007){finite(e.IntValue0,'MaxStamina');maxima.Stamina=(maxima.Stamina??0)+e.IntValue0;}
      continue;
    }
    if(!e||e.ConfigName!=='Buff/Buff_Default') throw new TypeError('Missing Buff_Default effect');
    for(const name of names) {
      for(const [target,suffix] of [[maxima,'Max'],[addRatios,'Add'],[delRatios,'Del']]) {
        const v=e[`Buff${name}${suffix}`];finite(v,`Buff${name}${suffix}`);
        target[name]=f((target[name]??0)+v);
      }
    }
  }
  for(const name of names)for(const target of [maxima,addRatios,delRatios])target[name]??=0;
  return {maxima,addRatios,delRatios};
}

export function prologueBuffIntervalRequests(effect) {
  if(![200001001,200001112].includes(effect?.ID)||effect.ConfigName!=='Buff/Buff_Default') throw new RangeError('Unsupported prologue buff effect');
  return names.filter(name=>name!=='Health').flatMap(attribute=>{
    const amount=effect[`Buff${attribute}Interval`];finite(amount,attribute);
    return amount===0?[]:[{attribute,amount:f(amount),sourceType:1,configId:effect.ID-200000000}];
  });
}
