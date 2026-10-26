// Derived from AttrRecoveryComponent.UpdateCd, RVA 0x2ED1E30.
// Produces a request for CostAttrValue; does not reproduce its effects/clamping.
// Callers must supply resolved runtime totals and the original clock conversion.
export function recoveryTick(source, context) {
  const {worldState, deltaTime, timeScale, current, target, interval,
    addRatio=0, delRatio=0, hasAddKey=true, hasDelKey=true,
    blockDecrease=false, moraleTargetDelta=0, vitalityAddDelta=0,
    satietyDelDelta=0, isLeadingRole=false}=context;
  for(const [key,value] of Object.entries({cd:source.cd,deltaTime,timeScale,current,target,interval,addRatio,delRatio,moraleTargetDelta,vitalityAddDelta,satietyDelDelta})) {
    if(!Number.isFinite(value)) throw new TypeError(`Invalid ${key}`);
  }
  if(timeScale<=0||interval<0||deltaTime<0||![1,2].includes(worldState)) throw new RangeError('Invalid recovery clock or world state');
  if(worldState===1) return {cd:source.cd,request:null};
  const cd=Math.fround(Math.fround(source.cd)-Math.fround(deltaTime));
  if(cd>0) return {cd,request:null};
  const nextCd=Math.fround(Math.fround(interval)/Math.fround(timeScale));
  const adjustedTarget=isLeadingRole&&source.attribute==='Morale'?Math.max(0,target+moraleTargetDelta):target;
  let amount=current>adjustedTarget?-1:current<adjustedTarget?1:0;
  if(amount<0&&blockDecrease) return {cd:nextCd,request:null};
  if(amount>0&&hasAddKey) {
    const ratio=Math.fround(addRatio+(isLeadingRole&&source.attribute==='Vitality'?vitalityAddDelta:0));
    amount=Math.max(0,Math.fround(amount*Math.fround(1+ratio)));
  }
  if(amount<0&&hasDelKey) {
    const ratio=Math.fround(delRatio+(isLeadingRole&&source.attribute==='Satiety'?satietyDelDelta:0));
    amount=Math.fround(amount*Math.fround(1+ratio));
  }
  return {cd:nextCd,request:{attribute:source.attribute,amount,argsType:3}};
}
