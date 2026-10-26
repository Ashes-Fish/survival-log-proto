// Single source of truth for "what happens when the player uses this furniture".
// Both the 2D reference room and the 3D runtime call this, so the conditional
// tutorial rules (obstacle removal, door unlock) cannot drift apart again.
import {startProbeNap, startProbeMeal, probeActionEvent, probeTutorialEvent} from '../prologue-probe.mjs';

// Furniture config id -> action kind. 9106 (cup) is drinkable scenery, 9107 is scrap.
export const ACTION_BY_FURNITURE = Object.freeze({
  9104: 'nap',
  9106: 'eat',
  9111: 'wardrobe',
  9113: 'door',
  9114: 'obstacle',
});

export function actionForFurniture(furnitureId) {
  return ACTION_BY_FURNITURE[furnitureId] ?? null;
}

// Returns {ok, state, message}. Never throws: callers render the message directly.
export function performAction(state, action, tables, options = {}) {
  try {
    switch (action) {
      case 'nap':
        return {ok: true, state: startProbeNap(state, tables), message: '开始小睡'};
      case 'story': {
        // Only story 1501 (障碍物) drives the tutorial (Guide 101, MissionType 6); the
        // notebook (1502) and window (1503) popups have no listener in Config_Guide.
        if (options.storyId === 1501) return {ok: true, state: probeTutorialEvent(state, 'story', tables), message: '已查看'};
        return {ok: true, state, message: '已查看'};
      }
      case 'wardrobe':
        return {ok: true, state: probeTutorialEvent(state, 'wardrobe', tables), message: '打开衣柜'};
      case 'eat': {
        const configId = options.configId ?? 9030;
        return {ok: true, state: startProbeMeal(state, tables, configId), message: '开始进食'};
      }
      case 'obstacle': {
        // Tutorial step 401 is the moment the obstacle may be removed; before that the
        // player only inspects it (step 101).
        if (state.tutorial.activeIds.includes(401)) {
          return {ok: true, state: probeActionEvent(state, 202, tables), message: '移除了门口的障碍物'};
        }
        return {ok: true, state: probeTutorialEvent(state, 'story', tables), message: '查看门口的障碍物'};
      }
      case 'door': {
        if (!state.tutorial.completedIds.includes(401)) {
          return {ok: false, state, message: '门被障碍物挡住了'};
        }
        return {ok: true, state: probeActionEvent(state, 203, tables), message: '打开房门'};
      }
      default:
        return {ok: false, state, message: '这里没有可用的交互'};
    }
  } catch (error) {
    return {ok: false, state, message: error.message};
  }
}
