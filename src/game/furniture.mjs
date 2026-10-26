// Furniture -> interaction buttons, straight from Config_Furniture.FurnitureFunc and
// Config_FurnitureFunc. FuncType decides what the button opens: 1 is a container bag,
// 2 is an action, everything else is not wired yet.
export const FUNC_TYPE = Object.freeze({bag: 1, action: 2});

// Action functions this runtime can actually perform, keyed by FurnitureFunc.ID.
// 401 (吃残余罐头, Action 201) is deliberately absent: it used to map to 'eat', which
// ate the wardrobe tuna instead of the scrap can.
export const ACTION_BY_FUNC = Object.freeze({
  400: 'nap',
  402: 'obstacle',
  403: 'door',
  404: 'wardrobe',
});

// ConditionSet fields this runtime evaluates. Any other non-empty field makes the
// result 'unknown' rather than guessing.
const EMPTY = (value) => value == null || value === '' || value === 0 || value === false || (Array.isArray(value) && !value.length);
const EVALUATED = new Set(['ID', 'Source', 'EventTag', 'EventNoTag', 'EventTagOr']);

// Returns true / false / null (null = condition uses fields not modelled here).
export function evaluateTagCondition(condition, tags) {
  if (!condition) return null;
  for (const [key, value] of Object.entries(condition)) if (!EVALUATED.has(key) && !EMPTY(value)) return null;
  const has = (tag) => tags.includes(tag);
  if (condition.EventTag?.length && !condition.EventTag.every(has)) return false;
  if (condition.EventNoTag?.some(has)) return false;
  if (condition.EventTagOr?.length && !condition.EventTagOr.some(has)) return false;
  return true;
}

// tags: the tutorial/event tags currently set. When omitted, visibility is not
// filtered (every configured button is listed, as before).
export function furnitureButtons(furnitureId, tables, {tags = null} = {}) {
  const furniture = tables.Furniture.find((row) => row.ID === furnitureId);
  if (!furniture) return [];
  const ids = furniture.FurnitureFunc ?? [];
  return ids
    .map((funcId) => tables.FurnitureFunc.find((row) => row.ID === funcId))
    .filter(Boolean)
    .map((func) => {
      const conditionId = func.VisibilityConditionSetId || 0;
      const condition = conditionId ? tables.ConditionSet?.find((row) => row.ID === conditionId) : null;
      const visible = !conditionId ? true : (tags && condition ? evaluateTagCondition(condition, tags) : null);
      return {
        id: func.ID,
        label: func.BtnName_Local || ('功能 ' + func.ID),
        tip: func.BtnTips_Local || '',
        type: func.FuncType,
        action: ACTION_BY_FUNC[func.ID] ?? null,
        bagId: furniture.BagId ?? 0,
        visible,
      };
    })
    // Hidden only when the condition is known to be false; unknown stays listed.
    .filter((button) => !tags || button.visible !== false);
}

// Story popup attached to the furniture (Config_Furniture.Story -> Config_Story).
export function furnitureStory(furnitureId, tables) {
  const furniture = tables.Furniture.find((row) => row.ID === furnitureId);
  if (!furniture?.Story) return null;
  const story = tables.Story?.find((row) => row.ID === furniture.Story);
  if (!story) return null;
  return {
    id: story.ID,
    title: story.StoryName_Local,
    body: story.Des1_Local,
    quote: (story.Des2_Local ?? '').replace(/\\n/g, '\n'),
    button: story.ButtonDes_Local || '确定',
  };
}
