import type { GameState } from "./models.js";

export const SAVE_KEY = "uprise-save";

export type SaveFileV1 = {
  version: 1;
  app: "uprise";
  savedAt: string;
  state: GameState;
};

export const createSaveFile = (state: GameState): SaveFileV1 => ({
  version: 1,
  app: "uprise",
  savedAt: new Date().toISOString(),
  state,
});

export const serializeSave = (state: GameState): string =>
  JSON.stringify(createSaveFile(state), null, 2);

export const parseSave = (raw: string): GameState | null => {
  try {
    const data = JSON.parse(raw) as Partial<SaveFileV1>;
    if (data?.version !== 1 || data.app !== "uprise" || !data.state) {
      return null;
    }
    return data.state;
  } catch {
    return null;
  }
};
