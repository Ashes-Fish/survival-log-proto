// Offline-derived clock arithmetic; see investigation/reports/clock-stage2.md.
// The caller supplies Unity-equivalent scaled/unscaled deltas and initial save
// time explicitly. No browser wall-clock speed or starting timestamp is guessed.
const f=Math.fround;
export const PAUSE_SCALE=f(0.0001);
export const DAY_SECONDS=86400;
const finite=(value,label)=>{if(!Number.isFinite(value))throw new TypeError(`Invalid ${label}`);return value;};
const integer=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`Invalid ${label}`);return value;};
function scale(value){integer(value,'toolsetTimeScale');if(value<1||value>DAY_SECONDS)throw new RangeError('Unsupported time scale');return value;}

export function toInternalTime(gameSeconds,toolsetTimeScale){
  finite(gameSeconds,'gameSeconds');scale(toolsetTimeScale);
  if(gameSeconds<0)throw new RangeError('Negative time');
  return f(f(gameSeconds)/f(toolsetTimeScale));
}

// Get24Time_Int truncates its internal float BEFORE mapping to 24-hour time.
export function toGameSeconds(internalTime,toolsetTimeScale){
  finite(internalTime,'internalTime');scale(toolsetTimeScale);
  if(internalTime<0)throw new RangeError('Negative time');
  const maxTime=Math.trunc(f(f(DAY_SECONDS)/f(toolsetTimeScale)));
  return Math.trunc(f(f(f(Math.trunc(f(internalTime)))/f(maxTime))*f(DAY_SECONDS)));
}

export function createGameClock({timerKind,gameSeconds,day,toolsetTimeScale,started,battleScale}){
  if(!['countUp','frozen'].includes(timerKind))throw new RangeError('Countdown timer is not implemented');
  integer(gameSeconds,'gameSeconds');integer(day,'day');scale(toolsetTimeScale);finite(battleScale,'battleScale');
  if(gameSeconds>=DAY_SECONDS||battleScale<0||typeof started!=='boolean')throw new RangeError('Invalid clock initialization');
  return {timerKind,internalTime:toInternalTime(gameSeconds,toolsetTimeScale),frozenGameSeconds:gameSeconds,day,toolsetTimeScale,started,battleScale,clockFrozen:false,timeSyncTimer:0};
}

export function clockReading(clock){
  const seconds=clock.timerKind==='frozen'?clock.frozenGameSeconds:toGameSeconds(clock.internalTime,clock.toolsetTimeScale);
  return {day:clock.day,gameSeconds:seconds,totalSeconds:clock.day*DAY_SECONDS+seconds};
}

// Mirrors only timer arithmetic and the 30-unscaled-second synchronization.
// Day settlement, weather, lighting and buffs belong to the caller's event system.
export function tickGameClock(source,{deltaTime,unscaledDeltaTime,worldPaused=false}){
  finite(deltaTime,'deltaTime');finite(unscaledDeltaTime,'unscaledDeltaTime');
  if(deltaTime<0||unscaledDeltaTime<0)throw new RangeError('Negative delta');
  const clock={...source},events=[];
  if(worldPaused||!clock.started)return {clock,events};
  if(!clock.clockFrozen&&clock.timerKind==='countUp'){
    const maxTime=Math.trunc(f(DAY_SECONDS/scale(clock.toolsetTimeScale)));
    const next=f(f(clock.internalTime)+f(deltaTime));
    // Native Update handles one rollover per frame. Reject an oversized driver
    // delta instead of silently inventing multi-day catch-up/event semantics.
    if(next>=2*maxTime)throw new RangeError('Delta crosses more than one day');
    clock.internalTime=next;
    if(clock.internalTime>=maxTime){clock.day++;clock.internalTime=f(clock.internalTime-maxTime);events.push({type:'dayRollover',day:clock.day});}
  }
  clock.timeSyncTimer=f(f(clock.timeSyncTimer)+f(unscaledDeltaTime));
  if(clock.timeSyncTimer>=30){clock.timeSyncTimer=0;events.push({type:'totalSecondsSync',totalSeconds:clockReading(clock).totalSeconds});}
  return {clock,events};
}

export function gameSpeedScale(level,chapter){
  if(level===0)return PAUSE_SCALE;
  if(level===1||level===4)return 1;
  if(level===2||level===3){const value=level===2?chapter.SpeedUp1:chapter.SpeedUp2;integer(value,'chapter speed');if(value<1)throw new RangeError('Invalid chapter speed');return f(value);}
  throw new RangeError('Unknown speed level');
}

export function createIdleSlowdown(){return {beforeScale:-1,elapsed:0,checkTimer:0};}
export function tickIdleSlowdown(source,{unscaledDeltaTime,battleScale,slowGearActive,timerKind,clockFrozen,tempSpeedBeforeScale,pendingSpeedTriggerTime,holdBoostBeforeScale,hasManualAction}){
  for(const [key,value] of Object.entries({unscaledDeltaTime,battleScale,tempSpeedBeforeScale,pendingSpeedTriggerTime,holdBoostBeforeScale}))finite(value,key);
  if(unscaledDeltaTime<0)throw new RangeError('Negative delta');
  const state={...source};let nextScale=battleScale;
  const cancel=()=>{if(state.beforeScale>=0){nextScale=state.beforeScale;state.beforeScale=-1;}};
  const applicable=slowGearActive&&timerKind!=='frozen'&&battleScale>PAUSE_SCALE&&tempSpeedBeforeScale<0&&pendingSpeedTriggerTime<0&&holdBoostBeforeScale<0&&!clockFrozen;
  if(!applicable){cancel();state.elapsed=0;return {state,battleScale:nextScale};}
  const active=state.beforeScale>=0;
  let elapsed=f(unscaledDeltaTime);
  if(!active){state.checkTimer=f(state.checkTimer+elapsed);elapsed=state.checkTimer;if(elapsed<0.25)return {state,battleScale:nextScale};}
  state.checkTimer=0;
  if(hasManualAction){state.elapsed=0;cancel();}
  else if(!active){state.elapsed=f(state.elapsed+elapsed);if(state.elapsed>=3&&battleScale>f(0.3)){state.beforeScale=battleScale;nextScale=f(0.3);}}
  return {state,battleScale:nextScale};
}
