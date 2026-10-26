// Protocol: original DifficultySelect.html. Native selection semantics:
// RA_SetParam 0x2A36FC0, PushSelection 0x2A35F10, MatchPresetId 0x2A35BC0.
// This adapter selects and preserves settings; it does not implement their effects.
export const difficultyPagePath='DifficultySelect/DifficultySelect.html';
const selectionError=message=>({ok:false,error:message});
const validLevels=levels=>Array.isArray(levels)&&levels.length===6&&levels.every(n=>Number.isInteger(n)&&n>=1&&n<=4);

export function createDifficultyCatalog(presets,params){
  if(!Array.isArray(presets)||!Array.isArray(params)||!presets.length)throw new TypeError('Invalid difficulty tables');
  const presetIds=new Set(),paramIds=new Set();
  for(const p of presets){
    if(!Number.isInteger(p.ID)||p.ID<1||presetIds.has(p.ID)||!validLevels(p.Levels))throw new TypeError('Invalid difficulty preset');
    presetIds.add(p.ID);
  }
  for(const p of params){
    if(!Number.isInteger(p.ParamType)||p.ParamType<1||p.ParamType>6||!Number.isInteger(p.Level)||p.Level<1||p.Level>4||p.ID!==p.ParamType*10+p.Level||paramIds.has(p.ID))throw new TypeError('Invalid difficulty parameter');
    if(![p.Value1,p.Value2,p.Value3,p.Value4].every(Number.isFinite))throw new TypeError('Invalid difficulty values');
    paramIds.add(p.ID);
  }
  if(paramIds.size!==24||presets.filter(p=>p.IsDefault===1).length!==1)throw new TypeError('Incomplete difficulty configuration');
  return structuredClone({presets,params});
}

export function validateDifficultySelection(catalog,selection){
  if(!selection||!validLevels(selection.levels))throw new TypeError('Invalid difficulty selection');
  const levels=[...selection.levels];
  const selectedPresetId=catalog.presets.find(p=>p.Levels.every((n,i)=>n===levels[i]))?.ID??-1;
  if(selection.selectedPresetId!==selectedPresetId)throw new TypeError('Difficulty preset does not match levels');
  return {levels,selectedPresetId};
}

export function createDifficultySelection(catalog){
  const preset=catalog.presets.find(p=>p.IsDefault===1);
  return {levels:[...preset.Levels],selectedPresetId:preset.ID};
}

export function reduceDifficulty(catalog,selection,type,data={}){
  let next;
  try{next=validateDifficultySelection(catalog,selection);}catch(e){return selectionError(e.message);}
  if(type==='SELECT_PRESET'){
    const preset=catalog.presets.find(p=>p.ID===data?.index);
    if(!preset)return selectionError('Unknown difficulty preset');
    next={levels:[...preset.Levels],selectedPresetId:preset.ID};
  }else if(type==='SET_PARAM'){
    const param=catalog.params.find(p=>p.ID===data?.index);
    if(!param)return selectionError('Unknown difficulty parameter');
    next.levels[param.ParamType-1]=param.Level;
    next.selectedPresetId=catalog.presets.find(p=>p.Levels.every((n,i)=>n===next.levels[i]))?.ID??-1;
  }else return selectionError('Unsupported difficulty event');
  return {ok:true,selection:next};
}

export function difficultySelectionMessage(catalog,selection){
  const checked=validateDifficultySelection(catalog,selection);
  return {type:'WebUI_DifficultySelect_SelectionMsg',data:{levels:checked.levels.join(';'),selectedPresetId:checked.selectedPresetId}};
}

export function difficultyMessages(catalog,selection,{bgPic='',localization={}}={}){
  return [
    {type:'WebUI_DifficultySelect_PresetsMsg',data:{bgPic,presets:catalog.presets.map(p=>({presetId:p.ID,name:p.PresetName_Local,desc:p.PresetDesc_Local,isDefault:p.IsDefault}))}},
    {type:'WebUI_DifficultySelect_ParamsMsg',data:{entries:catalog.params.map(p=>({paramType:p.ParamType,level:p.Level,paramName:p.ParamName_Local,levelName:p.LevelName_Local,effectDesc:p.EffectDesc_Local}))}},
    difficultySelectionMessage(catalog,selection),
    {type:'WebUI_DifficultySelect_LocalizationMsg',data:localization},
  ];
}

// Preserve all four source values without inventing gameplay interpretations.
export function selectedDifficultyParams(catalog,selection){
  const checked=validateDifficultySelection(catalog,selection);
  return checked.levels.map((level,i)=>structuredClone(catalog.params.find(p=>p.ParamType===i+1&&p.Level===level)));
}

// Effects are opt-in: the caller must explicitly declare implemented ParamTypes.
// A successful UI selection never implies gameplay support.
export function difficultyCoverage(catalog,selection,implementedParamTypes=[]){
  const selected=selectedDifficultyParams(catalog,selection);
  const unsupported=selected.filter(p=>!implementedParamTypes.includes(p.ParamType));
  return {complete:unsupported.length===0,unsupported:unsupported.map(p=>({paramType:p.ParamType,name:p.ParamName_Local,level:p.Level,description:p.EffectDesc_Local}))};
}
