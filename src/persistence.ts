import type { GameRuntime, GameState } from "./models.js";

export const SAVE_KEY = "uprise-save";

export type SaveFileV1 = {
  version: 1;
  app: "uprise";
  savedAt: string;
  state: GameState;
};

export type SaveFileV2 = {
  version: 2;
  app: "uprise";
  savedAt: string;
  runtime: GameRuntime;
};

export const createSaveFile = (runtime: GameRuntime): SaveFileV2 => ({
  version: 2,
  app: "uprise",
  savedAt: new Date().toISOString(),
  runtime,
});

export const serializeSave = (runtime: GameRuntime): string =>
  JSON.stringify(createSaveFile(runtime), null, 2);

const normalizeRuntime = (runtime: Partial<GameRuntime>): GameRuntime => ({
  faction: runtime.faction ?? "rebels",
  nowHours: runtime.nowHours ?? 0,
  headquartersId: runtime.headquartersId ?? "",
  resources: runtime.resources ?? { credits: 0, intel: 0 },
  personnel: runtime.personnel ?? [],
  materials: runtime.materials ?? [],
  missions: runtime.missions ?? [],
  missionOffers: runtime.missionOffers ?? [],
  travel: runtime.travel ?? [],
  eventLog: runtime.eventLog ?? [],
});

const splitLegacyState = (state: unknown): GameRuntime => {
  const legacy = state as Partial<GameState> & {
    faction?: GameRuntime["faction"];
    nowHours?: number;
    headquartersId?: string;
    resources?: GameRuntime["resources"];
    personnel?: GameRuntime["personnel"];
    materials?: GameRuntime["materials"];
    missions?: GameRuntime["missions"];
    missionOffers?: GameRuntime["missionOffers"];
    travel?: GameRuntime["travel"];
    eventLog?: GameRuntime["eventLog"];
  };
  if (legacy.runtime) {
    return normalizeRuntime(legacy.runtime);
  }
  return normalizeRuntime({
    faction: legacy.faction,
    nowHours: legacy.nowHours,
    headquartersId: legacy.headquartersId,
    resources: legacy.resources,
    personnel: legacy.personnel,
    materials: legacy.materials,
    missions: legacy.missions,
    missionOffers: legacy.missionOffers,
    travel: legacy.travel,
    eventLog: legacy.eventLog,
  });
};

export const parseSave = (raw: string): GameRuntime | null => {
  try {
    const data = JSON.parse(raw) as Partial<SaveFileV1 & SaveFileV2>;
    if (data.app !== "uprise") {
      return null;
    }
    if (data.version === 2 && data.runtime) {
      return normalizeRuntime(data.runtime);
    }
    if (data.version === 1 && data.state) {
      return splitLegacyState(data.state);
    }
    return null;
  } catch {
    return null;
  }
};
