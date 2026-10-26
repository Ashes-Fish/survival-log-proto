// Dynamic event director (M8), reconstructed from GameCore.HotUpdate.Battle.Logic
// .DynamicEventManager and the DynamicEvent_* FSM states (GameAssembly.dll SHA256
// b0d29e5d…, offline Capstone; see investigation/fixes-2026-10-22/notes.md 批次 5).
//
// Native model, in order:
//  • Pool = Config_Event rows with DemoTwoMode ∈ {0,1} and EndlessMode ∈ {0,1,9}
//    (GameKey.IsRowBlockedInDemoTwo RVA 0x2566DA0 / IsRowBlockedInEndless 0x2566E10),
//    non-son, Type ∈ {Choice 1, Result 2, Task 3} (DynamicEventConfigType).
//  • Daily roll: OnHourUpdate (RVA 0x30B07F0) calls TriggerRandomEvent (0x30C0D20) once
//    at hour 0 (and StartBattle_AfterAgent at game start). Each non-grouped config goes
//    through CreateDynamicEventArgs (0x30A4970): not already in progress, PlayerSelectId
//    matches, every DynamicCondition.Test passes, then TriggerHour =
//    RandomInt(TimeMin, TimeMax==24?23:TimeMax) (inclusive, 0x26DC540).
//  • Conditions (AddConditions 0x30A0CA0): DataCheckCondition (0x25D9550: active only when
//    DataMin≥1 && DataMax≥1; 0-based GetDay ∈ [DataMin-1, DataMax-1]), ProbabilityTest
//    (0x25EECD0: 0≤DayRate≤1; DayRate > RandomFloat(0,1)), CDTest (0x25D9310: cd dict —
//    no key ⇒ pass, -1 ⇒ never, else GetDay ≥ value), ConditionSet (NeedConditionSetId? no
//    — ConditionSetId 0x168 via CheckConditionSet). CdResult.DoResult (0x25D9400) writes
//    cd[id] = canRepeat ? GetDay+DayCD : -1.
//  • Grouped events (GroupKey): TriggerGroupEvent (0x30BFA90) collects candidates that pass
//    their non-probability conditions (skipProbability=true), rolls once with maxP = the
//    largest DayRate, picks one uniformly (RandomList), and WriteGroupCooldown (0x30C79A0)
//    writes GroupDayCD (or each row's DayCD) for every member.
//  • Processing: ProcessTriggeredEvents(hour) (0x30B28B0) fires the args whose TriggerHour
//    == hour. CountUpTimer.CostTime emits HourUpdate for every crossed hour (also while
//    sleeping/travelling), so hours missed during sleep still fire.
//  • Type 3 tasks (DynamicEvent_DoTask): StartRewardSetId paid once on accept
//    (RunStartRewardOnTriggerExit 0x30B7140 / OnTaskAccepted 0x30B1570), RewardSetId on
//    completion (DoTask.Update → CheckAllTasksCompletion), ExpiredRewardSetId on timeout
//    (TaskFinishTime = total + TaskTime). Progress: ActionTask (ActionRequire×ActionTime,
//    OnActionCompleted 0x30AEDA0), ItemTask (ItemRequire×ItemTime, OnItemUsed), Condition
//    SetTask (TaskConditionSetId), TasteTask (TasteRequire). Result events (Type 1/2) pay
//    RewardSetId in DynamicEvent_DoResult.Exit (0x260A570).
//  • Choice options gate on the CHILD row's NeedConditionSetId (CheckEventChoiceCondition
//    0x307F2A0: CheckAttributes && CheckItemNeed && CheckTags); the default option always
//    passes. Disabled options show SR_UI_DynamicEventChose_2/3/4.
//  • Reward ActiveEvent (ExecuteActiveEventReward 0x26E4DF0): force-trigger, filtered by
//    PlayerSelectId and skipped when not in the pool or already in progress.
//
// Fire/placement timing inside a game frame is reconstructed for the web loop; the native
// behaviour-tree scheduling of popups is not. Marked INFERRED where it departs.
import * as R from './world-rules.mjs';

const NORMAL_DEMO = new Set([0, 1]);
const NORMAL_ENDLESS = new Set([0, 1, 9]);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// resIndex: 'EventNew/e111' -> 'EventNew/e111.webp' (data/res-index.json, built from WebUI/Res).
export function createEvents(T, tables, resIndex = {}) {
  const icon = (path) => { const key = path ? 'EventNew/' + path.split('/').pop() : ''; return resIndex[key] ? '../../Res/' + resIndex[key] : ''; };
  const pool = tables.Event.filter((e) => !e.IsSon && NORMAL_DEMO.has(e.DemoTwoMode) && NORMAL_ENDLESS.has(e.EndlessMode) && (e.Type === 1 || e.Type === 2 || e.Type === 3));
  const singles = pool.filter((e) => !e.GroupKey);
  const groups = new Map();
  for (const e of pool) if (e.GroupKey) (groups.get(e.GroupKey) ?? groups.set(e.GroupKey, []).get(e.GroupKey)).push(e);

  // ---- per-event condition gate (CreateDynamicEventArgs) --------------------------
  function dataOk(e, day) {
    // DataCheckCondition active only when both bounds ≥ 1; stored as (bound-1) vs 0-based day.
    if (!(e.DataMin >= 1 && e.DataMax >= 1)) return true;
    return day >= e.DataMin - 1 && day <= e.DataMax - 1;
  }
  function cdOk(w, e, day) {
    const v = w.events.cd[e.ID];
    if (v === undefined) return true;   // no record → available
    if (v === -1) return false;         // never repeat
    return day >= v;                    // available again on day v
  }
  function playerOk(session, e) {
    return !(e.PlayerSelectId?.length) || e.PlayerSelectId.includes(session.playerSelectId);
  }
  // Every DynamicCondition except the probability test (handled per-mode).
  function passConditions(session, e, day) {
    const w = session.world;
    if (!playerOk(session, e)) return false;
    if (!dataOk(e, day)) return false;
    if (!cdOk(w, e, day)) return false;
    if (e.ConditionSetId) { const c = R.checkCondition(w, T, e.ConditionSetId); if (!(c.ok && c.known)) return false; }
    return true;
  }
  const inProgress = (w, id) =>
    w.events.active?.id === id || w.events.scheduled.some((a) => a.id === id) || w.events.tasks.some((t) => t.id === id);

  function triggerHour(w, e) {
    const max = e.TimeMax === 24 ? 23 : (e.TimeMax ?? 23);
    const min = e.TimeMin ?? 0;
    if (max <= min) return min;
    // RandomInt(min, max) inclusive (RandomManager.RandomInt adds 1 to max).
    return min + Math.floor(R.rand(w) * (max - min + 1));
  }

  // ---- daily roll (TriggerRandomEvent) --------------------------------------------
  function rollDay(session) {
    const w = session.world;
    const day = w.time.day;
    // Hours already elapsed today are missed (native fires TriggerHour == hour going
    // forward); the day roll runs at hour 0 so normally nothing is dropped, but the very
    // first roll (StartBattle_AfterAgent) happens at the start-of-game hour.
    const curHour = Math.floor(w.time.seconds / 3600);
    const schedule = (e, extra = {}) => {
      const hour = triggerHour(w, e);
      if (hour < curHour) return false;
      w.events.scheduled.push({id: e.ID, hour, overdue: false, ...extra});
      return true;
    };
    for (const e of singles) {
      if (inProgress(w, e.ID)) continue;
      if (!passConditions(session, e, day)) continue;
      // ProbabilityTestCondition: DayRate > RandomFloat(0,1) (DayRate 0 ⇒ never).
      if (R.rand(w) >= clamp01(e.DayRate ?? 0)) continue;
      schedule(e);
    }
    for (const [key, members] of groups) {
      if (members.some((e) => inProgress(w, e.ID))) continue;
      const cands = members.filter((e) => passConditions(session, e, day)); // skipProbability
      if (!cands.length) continue;
      const maxP = clamp01(Math.max(...cands.map((e) => e.DayRate ?? 0)));
      if (maxP <= 0) continue;
      if (R.rand(w) >= maxP) continue;
      const pick = cands[Math.min(cands.length - 1, Math.floor(R.rand(w) * cands.length))];
      schedule(pick, {group: key});
      // WriteGroupCooldown: GroupDayCD (or a repeatable row's DayCD) for every member.
      const cd = pick.GroupDayCD || pick.DayCD || 0;
      for (const m of members) w.events.cd[m.ID] = m.CanRepeat ? day + (cd || 0) : -1;
    }
  }

  function ensureDay(session) {
    const w = session.world;
    if (w.events.day === w.time.day) return;
    // Day advanced: events still scheduled from the previous day were crossed during
    // sleep/travel (CountUpTimer emits every hour) — let them fire regardless of hour.
    for (const a of w.events.scheduled) a.overdue = true;
    w.events.day = w.time.day;
    rollDay(session);
  }

  // ---- choice options -------------------------------------------------------------
  // CheckEventChoiceCondition: the default option always passes; others need the child
  // row's NeedConditionSetId (attributes + item need + tags). Item need searches the
  // player bag (home-furniture bags are not reachable from here; INFERRED narrower).
  function choiceOptions(session, e) {
    const w = session.world;
    return (e.ChoseID ?? []).map((id, i) => {
      const child = T.event.get(id);
      const label = e.ChoseName_Local?.[i] ?? ('选项' + (i + 1));
      const isDefault = id === e.Default;
      if (isDefault || !child?.NeedConditionSetId) return {id, label, enabled: true, reason: '', isDefault};
      const c = R.checkCondition(w, T, child.NeedConditionSetId);
      return {id, label, enabled: c.ok, reason: c.ok ? '' : c.lacks.join('，'), isDefault};
    });
  }

  function describe(session, e, {result = null} = {}) {
    return {
      id: e.ID, type: e.Type, title: e.Name_Local,
      text: (result ?? e.EventDes_Local ?? e.EventDesTaskEnd_Local ?? '').replace(/\\n/g, '\n'),
      icon: icon(e.Icon),
      ok: e.OKDes_Local || (e.Type === 3 ? '接受' : '确定'),
      choices: choiceOptions(session, e),
      defaultChoice: e.Default || null, countdown: e.Countdown || 0, rewardSetId: e.RewardSetId || 0,
    };
  }

  // ---- firing ---------------------------------------------------------------------
  function popNext(session) {
    const w = session.world;
    if (w.events.active) return null;
    const hour = Math.floor(w.time.seconds / 3600);
    const i = w.events.scheduled.findIndex((a) => a.overdue || a.hour <= hour);
    if (i < 0) return null;
    const [arg] = w.events.scheduled.splice(i, 1);
    const e = T.event.get(arg.id);
    if (!e) return null;
    w.events.active = {id: arg.id};
    return describe(session, e);
  }

  // ---- task progress --------------------------------------------------------------
  // ActionTask/ItemTask (OnTestFinish 0x25D8FE0 / 0x25EE840): each ActionRequire[i] needs
  // ActionTime[i] completions (a bare require with no time means once). Progress is counted
  // per config id in task.action / task.item (OnActionCompleted / OnItemUsed).
  function needPairs(ids, times) {
    const need = new Map();
    (ids ?? []).forEach((id, i) => need.set(id, (need.get(id) ?? 0) + Math.max(1, times?.[i] ?? 1)));
    return need;
  }
  function taskComplete(w, task, e) {
    for (const [id, want] of needPairs(e.ActionRequire, e.ActionTime)) if ((task.action[id] ?? 0) < want) return false;
    for (const [id, want] of needPairs(e.ItemRequire, e.ItemTime)) if ((task.item[id] ?? 0) < want) return false;
    if (e.TaskConditionSetId) { const c = R.checkCondition(w, T, e.TaskConditionSetId); if (!c.ok) return false; }
    return true;
  }
  function finishTask(session, task, e, {expired = false} = {}) {
    const w = session.world;
    w.events.tasks = w.events.tasks.filter((t) => t !== task);
    w.events.cd[e.ID] = e.CanRepeat ? w.time.day + (e.DayCD || 0) : -1;
    const rewardId = expired ? e.ExpiredRewardSetId : e.RewardSetId;
    const reward = rewardId ? R.applyReward(w, T, rewardId) : null;
    w.events.log.push({id: e.ID, task: expired ? 'expired' : 'done', day: w.time.day + 1});
    const text = (expired ? e.EventDesTaskEnd_Local : (e.DoneInfo_Local || e.EventDesTaskEnd_Local)) || e.Name_Local;
    return {...describe(session, e, {result: text}), choices: [], done: true, expired, reward};
  }

  return {
    // Called by the loop with elapsed game seconds; returns one event popup or null.
    tick(session) {
      const w = session.world;
      if (w.dead || w.action) return null;
      ensureDay(session);
      // ActiveEvent rewards (ExecuteActiveEventReward): force-trigger, filtered and deduped.
      if (w.events.pending.length) {
        const rest = [];
        for (const id of w.events.pending) {
          const e = T.event.get(id);
          const ok = e && pool.includes(e) && playerOk(session, e) && !inProgress(w, id) && !w.events.scheduled.some((a) => a.id === id);
          if (ok) w.events.scheduled.unshift({id, hour: 0, overdue: true, forced: true});
          else if (e && inProgress(w, id)) { /* drop: already running */ }
          else rest.push(id);
        }
        w.events.pending = rest.filter((id) => !T.event.get(id)); // keep only ids we could not resolve at all
      }
      // Task expiry, then ConditionSet-task completion (e.g. 生存N天 driven by the day).
      for (const task of [...w.events.tasks]) {
        if (task.finishTotal != null && w.time.total >= task.finishTotal) {
          const e = T.event.get(task.id);
          if (e) return finishTask(session, task, e, {expired: true});
        }
        const e = T.event.get(task.id);
        if (e && taskComplete(w, task, e)) return finishTask(session, task, e);
      }
      return popNext(session);
    },

    // Resolve the active popup. choiceId is the chosen child id (choice events) or null.
    resolve(session, eventId, choiceId = null) {
      const w = session.world;
      const e = T.event.get(eventId);
      if (w.events.active?.id === eventId) w.events.active = null;
      w.events.log.push({id: eventId, choice: choiceId, day: w.time.day + 1});
      if (!e) return {reward: null, followUp: null};

      // Choice event → the chosen child becomes the outcome.
      const chosen = choiceId ? T.event.get(choiceId) : null;
      const target = chosen ?? e;

      // Task event (Type 3): confirming accepts the task. StartRewardSetId is paid once
      // (RunStartRewardOnTriggerExit / OnTaskAccepted); RewardSetId waits for completion.
      if (target.Type === 3) {
        const start = target.StartRewardSetId ? R.applyReward(w, T, target.StartRewardSetId) : null;
        const finishTotal = target.TaskTime > 0 ? w.time.total + target.TaskTime : null;
        w.events.tasks.push({id: target.ID, startDay: w.time.day, finishTotal, action: {}, item: {}});
        // Writing CD on accept keeps it from re-rolling while the task is live.
        w.events.cd[target.ID] = -1;
        return {reward: start, followUp: null, accepted: true};
      }

      // Result/Choice outcome (DynamicEvent_DoResult.Exit): pay RewardSetId, write CD.
      w.events.cd[e.ID] = e.CanRepeat ? w.time.day + (e.DayCD || 0) : -1;
      const reward = target.RewardSetId ? R.applyReward(w, T, target.RewardSetId) : null;
      return {reward, followUp: chosen ? describe(session, chosen, {result: chosen.EventDes_Local}) : null};
    },

    // A timed action finished (handleEvents 'completed'): advances ActionTask/ItemTask.
    onAction(session, actionId, itemConfigId = null) {
      const w = session.world;
      let popup = null;
      for (const task of [...w.events.tasks]) {
        const e = T.event.get(task.id);
        if (!e) continue;
        if (actionId != null && (e.ActionRequire ?? []).includes(actionId)) task.action[actionId] = (task.action[actionId] ?? 0) + 1;
        if (itemConfigId != null && (e.ItemRequire ?? []).includes(itemConfigId)) task.item[itemConfigId] = (task.item[itemConfigId] ?? 0) + 1;
        if (taskComplete(w, task, e) && !popup) popup = finishTask(session, task, e);
      }
      return popup;
    },
    onStory(session, storyId) { R.addTag(session.world, 'Story_' + storyId); },
    describe: (session, id) => (T.event.get(id) ? describe(session, T.event.get(id)) : null),
    activeTasks: (session) => session.world.events.tasks.map((t) => {
      const e = T.event.get(t.id);
      return {id: t.id, title: e?.Name_Local ?? String(t.id), info: (e?.Info_Local || e?.EventDes_Local || '').replace(/\\n/g, ' ')};
    }),
    poolSize: () => pool.length,
    eligibleNow: (session) => { ensureDay(session); return session.world.events.scheduled.map((a) => a.id); },
  };
}
