// Node-side table loader for tests and tools (the browser uses src/data/configs.mjs).
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
export const ENGINE_TABLES = ['Item', 'Action', 'Effect', 'Buff', 'Furniture', 'FurnitureFunc', 'ConditionSet', 'RewardSet', 'Bag',
  'PlayAttribute', 'Chapter', 'RandomGroup', 'CookingRecipe', 'ProductionList', 'Shop', 'Event', 'Story', 'DeathInfo', 'Player',
  'PlayerSelect', 'GlobalSetting', 'MapPoint', 'ConstantText', 'GuidanceNpc', 'Weather', 'DailyWeather', 'EventLog', 'BlackScreen', 'Instance',
  'Package', 'ProductionLv', 'CookingLv', 'PlantLv', 'TrapLv', 'ExploreLv', 'DefenseLv', 'SlotType', 'Plant', 'FurniturePlant', 'EnvArea', 'EnvAreaWeather'];

const cache = new Map();
export function loadNodeTables(names = ENGINE_TABLES) {
  const out = {};
  for (const name of names) {
    if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(join(DATA_DIR, 'Config_' + name + '.json'), 'utf8')));
    out[name] = cache.get(name);
  }
  return out;
}
export const readScene = (id) => JSON.parse(readFileSync(join(DATA_DIR, '..', 'world', 'scenes', id + '.json'), 'utf8'));
