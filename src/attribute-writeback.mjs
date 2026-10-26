// Numeric segment of AttributeComponent.CostAttrValue, RVA 0x2ED2E00.
// Caller must first resolve effect callbacks, ratios and dynamic maximum.
// This function deliberately does not implement the effect graph or dependencies.
const supported = new Set(['Satiety', 'Morale', 'Stamina', 'Vitality']);
const f = Math.fround;
export function attributeWriteback({attribute, current, amount, maximum,
  costRatio=0, sourceType=0, foodSubCategory=0, foodRatio=0,
  isLeadingRole=false, vitalityItemAddDelta=0, locked=false}) {
  for (const [key,value] of Object.entries({current,amount,maximum,costRatio,foodRatio,vitalityItemAddDelta})) {
    if (!Number.isFinite(value)) throw new TypeError(`Invalid ${key}`);
  }
  if (maximum<0 || maximum>2147483 || current<0 || current>2147483) throw new RangeError('Attribute out of supported fixed-point range');
  if (!supported.has(attribute) || amount===0) return {value:current,requestedDelta:0,appliedDelta:0,ignored:true,dead:false};
  let adjusted=f(amount);
  if (sourceType===2 && adjusted>0) {
    if ((attribute==='Satiety'||attribute==='Morale') && foodSubCategory>=1 && foodSubCategory<=11) adjusted=f(adjusted*f(1+f(foodRatio)));
    if (attribute==='Vitality' && isLeadingRole) adjusted=Math.max(0,f(adjusted*f(1+f(vitalityItemAddDelta))));
  }
  const requestedDelta=f(f(1+f(costRatio))*adjusted);
  const clamped=Math.max(0,Math.min(f(maximum),f(f(current)+requestedDelta)));
  // GameKey.Attr_ScalingRatio = 1000 (RVA 0x256CB5A); SetBaseValue_Float
  // multiplies in float32 and truncates to int32 (RVA 0x2ED4E57).
  const value=locked?current:f(Math.trunc(f(clamped*1000))/1000);
  return {value,requestedDelta,appliedDelta:f(value-current),ignored:false,dead:attribute==='Vitality'&&clamped<=0};
}
