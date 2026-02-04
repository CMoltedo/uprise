import type { GameRuntime } from "../models.js";
import { SAVE_KEY, parseSave, serializeSave } from "../persistence.js";
import { getUniverseDate } from "../time.js";

export const SAVE_SLOTS = [1, 2, 3] as const;

export const getSlotKey = (slot: number) => `${SAVE_KEY}-slot-${slot}`;

export const readSlotMeta = (slot: number) => {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(getSlotKey(slot));
  if (!raw) {
    return null;
  }
  try {
    const data = JSON.parse(raw) as {
      app?: string;
      version?: number;
      runtime?: { nowHours?: number };
      state?: { runtime?: { nowHours?: number }; nowHours?: number };
    };
    if (data.app !== "uprise") {
      return null;
    }
    const nowHours =
      data.version === 2
        ? data.runtime?.nowHours ?? 0
        : data.state?.runtime?.nowHours ?? data.state?.nowHours ?? 0;
    const date = getUniverseDate(nowHours);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    return { simStamp: `${year}-${month}-${day} ${hour}h` };
  } catch {
    return null;
  }
};

export const saveSlot = (slot: number, runtime: GameRuntime) => {
  if (typeof localStorage === "undefined") {
    return;
  }
  const payload = serializeSave(runtime);
  localStorage.setItem(getSlotKey(slot), payload);
};

export type SlotLoadResult =
  | { status: "ok"; runtime: GameRuntime }
  | { status: "missing" | "invalid" };

export const loadSlot = (slot: number): SlotLoadResult => {
  if (typeof localStorage === "undefined") {
    return { status: "missing" };
  }
  const raw = localStorage.getItem(getSlotKey(slot));
  if (!raw) {
    return { status: "missing" };
  }
  const loaded = parseSave(raw);
  if (!loaded) {
    return { status: "invalid" };
  }
  return { status: "ok", runtime: loaded };
};
