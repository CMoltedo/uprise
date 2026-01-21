import type {
  EventLogEntry,
  GameState,
  Location,
  MaterialItem,
  MissionInstance,
  MissionPlan,
  Personnel,
  ResourceBundle,
  TravelAssignment,
} from "./models.js";

type WithId = { id: string };

type PartialWithId<T extends WithId> = Partial<T> & WithId;

export interface ScenarioOverrides {
  faction?: GameState["faction"];
  nowHours?: number;
  headquartersId?: string;
  resources?: Partial<ResourceBundle>;
  personnel?: Array<PartialWithId<Personnel>>;
  materials?: Array<PartialWithId<MaterialItem>>;
  locations?: Array<PartialWithId<Location>>;
  missionPlans?: Array<PartialWithId<MissionPlan>>;
  missions?: Array<PartialWithId<MissionInstance>>;
  travel?: Array<PartialWithId<TravelAssignment>>;
  eventLog?: Array<PartialWithId<EventLogEntry>>;
}

const mergeById = <T extends WithId>(
  base: T[],
  overrides: Array<PartialWithId<T>> | undefined,
  mergeItem: (current: T, override: PartialWithId<T>) => T,
): T[] => {
  if (!overrides || overrides.length === 0) {
    return base;
  }
  const map = new Map(base.map((item) => [item.id, item]));
  for (const override of overrides) {
    const existing = map.get(override.id);
    if (existing) {
      map.set(override.id, mergeItem(existing, override));
    } else {
      map.set(override.id, override as T);
    }
  }
  return Array.from(map.values());
};

const mergeLocation = (
  current: Location,
  override: PartialWithId<Location>,
): Location => ({
  ...current,
  ...override,
  tags: override.tags ?? current.tags,
  missionPlanIds: override.missionPlanIds ?? current.missionPlanIds,
  sector: override.sector ?? current.sector,
  position: override.position ?? current.position,
  attributes: {
    ...current.attributes,
    ...override.attributes,
  },
  subLocations: override.subLocations ?? current.subLocations,
});

export const buildScenario = (
  baseline: GameState,
  overrides?: ScenarioOverrides,
): GameState => {
  if (!overrides) {
    return baseline;
  }

  return {
    ...baseline,
    faction: overrides.faction ?? baseline.faction,
    nowHours: overrides.nowHours ?? baseline.nowHours,
    headquartersId: overrides.headquartersId ?? baseline.headquartersId,
    resources: {
      ...baseline.resources,
      ...overrides.resources,
    },
    personnel: mergeById(
      baseline.personnel,
      overrides.personnel,
      (current, override) => ({ ...current, ...override }),
    ),
    materials: mergeById(
      baseline.materials,
      overrides.materials,
      (current, override) => ({ ...current, ...override }),
    ),
    locations: mergeById(baseline.locations, overrides.locations, mergeLocation),
    missionPlans: mergeById(
      baseline.missionPlans,
      overrides.missionPlans,
      (current, override) => ({ ...current, ...override }),
    ),
    missions: mergeById(
      baseline.missions,
      overrides.missions,
      (current, override) => ({ ...current, ...override }),
    ),
    travel: mergeById(
      baseline.travel,
      overrides.travel,
      (current, override) => ({ ...current, ...override }),
    ),
    eventLog: mergeById(
      baseline.eventLog,
      overrides.eventLog,
      (current, override) => ({ ...current, ...override }),
    ),
  };
};
