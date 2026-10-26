// Closed timing/termination segment for Action/Item_Bar_Default.
// Effect application and inventory changes belong to caller; emitted ordered events
// are not a claim that all downstream callbacks have been ported.
const f=Math.fround;
export function startFoodAction({itemInstanceId,action,timeScale,effectiveDuring=action?.During}) {
 if(!action||![100009030,100009031].includes(action.ID)||action.EffectConfigID!==action.ID||action.During!==600) throw new RangeError('Only observed tuna/chips actions are supported');
 if(!Number.isFinite(timeScale)||timeScale<=0||!Number.isFinite(effectiveDuring)||effectiveDuring<=0||!Number.isSafeInteger(itemInstanceId)||itemInstanceId<=0) throw new TypeError('Invalid action context');
 const duration=f(f(effectiveDuring)/f(timeScale));
 return {itemInstanceId,actionId:action.ID,duration,remaining:duration,status:'active',attributeHold:[...action.AttributeHold]};
}
export function stepFoodAction(source,deltaTime) {
 if(!Number.isFinite(deltaTime)||deltaTime<0) throw new TypeError('Invalid action delta');
 if(source.status!=='active') return {state:{...source},events:[]};
 if(!Number.isFinite(source.remaining)||source.remaining<=0) throw new TypeError('Invalid active action countdown');
 const remaining=f(source.remaining-f(deltaTime));
 if(remaining>0) return {state:{...source,remaining},events:[]};
 return {state:{...source,remaining,status:'completed',attributeHold:[]},events:['System_Completed','System_End']};
}
export function cancelFoodAction(source) {
 if(source.status!=='active') return {state:{...source},events:[]};
 return {state:{...source,status:'cancelled',attributeHold:[]},events:['System_End']};
}
// The single-use food decrement occurs at the final AE_EatFinished node of completed
// sequence, after End attributes and buff hooks; never call on Start or cancel.
export function consumeCompletedFood(source,item) {
 if(source.status!=='completed'||source.itemInstanceId!==item.instanceId||![9030,9031].includes(item.configId)||source.actionId!==100000000+item.configId||item.useTimes!==1) throw new RangeError('Invalid completed food consumption');
 return {...item,useTimes:0,removed:true};
}
