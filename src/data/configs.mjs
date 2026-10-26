// One loader for the config tables. The browser fetches JSON from ./data; Node tests
// read the same files synchronously, so both paths see identical rows.
export const CONFIG_NAMES = [
  'PlayAttribute', 'Chapter', 'Effect', 'Item', 'Action', 'Guide',
  'GuidanceFurniture', 'Furniture', 'Bag', 'FurnitureFunc', 'MapPoint',
];

const cache = new Map();

// PrologueExtras is a slice of ConditionSet/Story (scripts/build-prologue-extras.mjs);
// it is unpacked into tables.ConditionSet and tables.Story.
const RAW_FILES = new Set(['PrologueMap', 'PrologueExtras']);

export async function loadTables({base = '../data/', extra = ['PrologueMap', 'PrologueExtras']} = {}) {
  const names = [...CONFIG_NAMES, ...extra];
  const entries = await Promise.all(names.map(async (name) => {
    const file = RAW_FILES.has(name) ? base + name + '.json' : base + 'Config_' + name + '.json';
    const response = await fetch(file);
    if (!response.ok) throw new Error('配置加载失败：' + name);
    return [name, await response.json()];
  }));
  const tables = Object.fromEntries(entries);
  if (tables.PrologueExtras) {
    tables.ConditionSet ??= tables.PrologueExtras.ConditionSet;
    tables.Story ??= tables.PrologueExtras.Story;
    tables.ConstantText ??= tables.PrologueExtras.ConstantText;
  }
  for (const [name, rows] of Object.entries(tables)) cache.set(name, rows);
  return tables;
}

export function cached(name) {
  return cache.get(name) ?? null;
}
