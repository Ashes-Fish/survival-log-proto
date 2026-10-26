// Normalize the timestamped histories a native save already carries into one
// timeline, and derive scheduling facts from it. Pure functions: no config tables,
// no game interaction, no guessing about wall time.
export const TIMELINE_SCHEMA = 1;
const INTERNAL_SECOND = 120; // Chapter 0 toolsetTimeScale; only used for phase readout

function listOf(value) { return Array.isArray(value) ? value : []; }

export function extractSaveTimeline(root) {
  if (!root || typeof root !== 'object') throw new TypeError('Missing decoded save');
  const cur = root.CurSave;
  if (!cur) throw new TypeError('Save has no CurSave');
  const infection = listOf(cur.VitalityHistory).map((entry) => {
    if (!Number.isSafeInteger(entry.Timestamp) || !Number.isFinite(entry.ValueBefore) || !Number.isFinite(entry.ValueAfter)) throw new TypeError('Malformed vitality record');
    return { t: entry.Timestamp, delta: entry.ChangeValue, before: entry.ValueBefore, after: entry.ValueAfter, configId: entry.ConfigId, sourceType: entry.SourceType };
  }).sort((a, b) => a.t - b.t);
  const buffs = listOf(cur.LeadingRoleBuffChanges).map((entry) => ({
    t: entry.Timestamp, buffId: entry.BuffConfigId, change: entry.ChangeType === 1 ? 'add' : 'remove',
  })).sort((a, b) => a.t - b.t);
  const actions = listOf(cur.LeadingRoleUsedActionsHistory).map((entry) => ({ t: entry.GameTime, actionId: entry.ActionConfigId })).sort((a, b) => a.t - b.t);
  const items = listOf(cur.LeadingRoleUsedItemsHistory).map((entry) => ({ t: entry.GameTime, itemId: entry.ItemConfigId, count: entry.ItemCount })).sort((a, b) => a.t - b.t);
  const eventLog = listOf(cur.EventLogHistory).map((entry) => ({ t: entry.Timestamp, id: entry.ID })).sort((a, b) => a.t - b.t);
  return { schema: TIMELINE_SCHEMA, day: cur.Day, gameTime: cur.GameTime, infection, buffs, actions, items, eventLog };
}

export function analyzeTimeline(timeline) {
  const infection = timeline.infection;
  const gaps = [];
  for (let index = 1; index < infection.length; index++) gaps.push(infection[index].t - infection[index - 1].t);
  const expected = gaps.length ? gaps[0] : null;
  const irregular = [];
  for (let index = 1; index < infection.length; index++) {
    const gap = infection[index].t - infection[index - 1].t;
    if (expected !== null && gap !== expected) irregular.push({ at: infection[index].t, gap });
  }
  const breaks = [];
  for (let index = 1; index < infection.length; index++) {
    if (infection[index - 1].after !== infection[index].before) {
      breaks.push({ at: infection[index].t, from: infection[index - 1].after, to: infection[index].before, drifted: infection[index].before - infection[index - 1].after });
    }
  }
  const duplicateBuffs = [];
  const seen = new Map();
  for (const event of timeline.buffs) {
    const key = event.t + '|' + event.buffId + '|' + event.change;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, times] of seen) if (times > 1) {
    const [t, buffId, change] = key.split('|');
    duplicateBuffs.push({ t: Number(t), buffId: Number(buffId), change, times });
  }
  const lifetimes = [];
  const open = new Map();
  for (const event of timeline.buffs) {
    if (event.change === 'add') { if (!open.has(event.buffId)) open.set(event.buffId, event.t); }
    else if (open.has(event.buffId)) {
      lifetimes.push({ buffId: event.buffId, from: open.get(event.buffId), to: event.t, duration: event.t - open.get(event.buffId) });
      open.delete(event.buffId);
    }
  }
  for (const [buffId, from] of open) lifetimes.push({ buffId, from, to: null, duration: null });
  return {
    schema: TIMELINE_SCHEMA,
    day: timeline.day, gameTime: timeline.gameTime,
    infection: {
      count: infection.length,
      first: infection.length ? infection[0].t : null,
      interval: expected,
      phaseInternalSeconds: infection.length ? infection[0].t / INTERNAL_SECOND : null,
      irregular, breaks,
      secondOff: infection.length ? (infection[0].t - (expected ?? 0)) : null,
    },
    buffs: { count: timeline.buffs.length, duplicateBuffs, lifetimes },
    actions: { count: timeline.actions.length },
    items: { count: timeline.items.length },
  };
}
