import type { GameRuntime, GameState } from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";
import { refreshMissionOffers } from "../engine.js";
import { parseSave } from "../persistence.js";

const DEFAULT_ADMIN_APPLY_KEY = "uprise-admin-current-apply";

const readAdminAppliedRuntime = (storageKey: string): GameRuntime | null => {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  const parsed = parseSave(raw);
  if (!parsed) {
    localStorage.removeItem(storageKey);
    return null;
  }
  localStorage.removeItem(storageKey);
  return parsed;
};

export const createInitialGameState = (
  adminApplyKey = DEFAULT_ADMIN_APPLY_KEY,
): GameState => {
  const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
  const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
  const appliedRuntime = readAdminAppliedRuntime(adminApplyKey);
  if (appliedRuntime) {
    return refreshMissionOffers({ ...scenario, runtime: appliedRuntime });
  }
  return refreshMissionOffers(scenario);
};
