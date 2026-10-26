// Source-derived initialization contract; does not claim full world creation.
// GameSaveManager.<CreateNewGame>d__37.MoveNext RVA 0x285F8B0.
// LeadingRole.Initialize RVA 0x2F5E5C0 reads Player.LinkAttr before SetInitValue.
const attributes=['Satiety','Morale','Stamina','Health','Vitality'];
function find(rows,id,label){const row=rows.find(r=>r.ID===id);if(!row)throw new Error(`Missing ${label} ${id}`);return row;}
export function resolveNewGame(tables,{playerSelectId,skipTutorial=false,skipOpening=false,difficulty}){
  if(!Number.isSafeInteger(playerSelectId)||typeof skipTutorial!=='boolean'||typeof skipOpening!=='boolean')throw new TypeError('Invalid new-game selection');
  if(!difficulty||!Array.isArray(difficulty.levels)||difficulty.levels.length!==6||difficulty.levels.some(v=>!Number.isInteger(v)||v<1||v>4))throw new TypeError('Invalid difficulty');
  const character=find(tables.PlayerSelect,playerSelectId,'character');
  const chapterId=skipTutorial?1:0,playerId=skipTutorial?character.PlayerConfigId:4,mapId=skipTutorial?character.InitMapConfigId:8;
  const player=find(tables.Player,playerId,'player'),chapter=find(tables.Chapter,chapterId,'chapter');
  const attr=find(tables.PlayAttribute,player.LinkAttr,'attributes'),bag=find(tables.Bag,player.Bag,'bag');
  // Restricted to the observed worker / standard prologue. Other selections
  // remain unknown; no inference from an empty BagComponent initializer alone.
  const observedPrologue=chapterId===0&&playerSelectId===1&&difficulty.levels.every(v=>v===2);
  let money=null;
  if(chapterId===0&&difficulty.levels[0]===2){
    const parameters=tables.DifficultyParam?.filter(r=>r.ParamType===1&&r.Level===2);
    if(parameters?.length!==1||parameters[0].Value1!==1)throw Error('Unsupported standard initial-money ratio');
    const fallback=find(tables.GlobalSetting,'DefaultMoney','global setting').Params1;
    if(!Number.isSafeInteger(fallback)||fallback<0)throw Error('Invalid default money');
    money=player.InitMoney>0?player.InitMoney:fallback;
  }
  return {version:'1.1.18599',playerSelectId,skipTutorial,skipOpening,difficulty:structuredClone(difficulty),
    character:character.Name_Local,chapterId,playerId,mapId,attributeConfigId:player.LinkAttr,
    scene:chapter.SceneName,worldState:chapter.WorldStateType,configuredTimeScale:chapter.TimeScale,
    initialSaveTime:{day:0,gameSeconds:0},
    baseAttributes:Object.fromEntries(attributes.map(key=>[key,{value:attr[key],maximum:attr['Max'+key],interval:attr['Interval'+key],target:attr['Target'+key]}])),
    configuredBuffs:[...player.BuffList],bag:{configId:bag.ID,cols:bag.Size[0],rows:bag.Size[1],burden:bag.Burden},
    inventory:observedPrologue?[]:null,money,
    coverage:{initialization:'native-derived',world:'not-created',inventory:observedPrologue?'observed empty worker backpack at first inspection; stage2-repeat screenshot04':'unknown',money:money===null?'unknown':'UserComponent.OnInit / DefaultMoney / standard ratio; not runtime measured',difficultyEffects:'only standard initial money branch',buffEffects:'not-applied',openingTimeline:'not-applied'}};
}
