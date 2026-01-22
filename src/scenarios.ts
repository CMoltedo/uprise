import type {
  EventLogEntry,
  GameState,
  Location,
  LocationAssignment,
  MaterialCatalogItem,
  MaterialItem,
  MissionOffer,
  MissionInstance,
  MissionPlan,
  MissionTypeConfig,
  Planet,
  Personnel,
  ResourceBundle,
  Sector,
  TravelAssignment,
} from "./models.js";

type WithId = { id: string };
type WithType = { type: string };

type PartialWithId<T extends WithId> = Partial<T> & WithId;
type PartialWithType<T extends WithType> = Partial<T> & WithType;

export interface ScenarioOverrides {
  faction?: GameState["faction"];
  nowHours?: number;
  headquartersId?: string;
  resources?: Partial<ResourceBundle>;
  materialCatalog?: Array<PartialWithId<MaterialCatalogItem>>;
  personnel?: Array<PartialWithId<Personnel>>;
  materials?: Array<PartialWithId<MaterialItem>>;
  sectors?: Array<PartialWithId<Sector>>;
  planets?: Array<PartialWithId<Planet>>;
  locations?: Array<PartialWithId<Location>>;
  missionPlans?: Array<PartialWithId<MissionPlan>>;
  missions?: Array<PartialWithId<MissionInstance>>;
  locationAssignments?: Array<PartialWithId<LocationAssignment>>;
  missionOffers?: Array<PartialWithId<MissionOffer>>;
  missionTypeConfigs?: Array<PartialWithType<MissionTypeConfig>>;
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

const mergeByType = <T extends WithType>(
  base: T[],
  overrides: Array<PartialWithType<T>> | undefined,
  mergeItem: (current: T, override: PartialWithType<T>) => T,
): T[] => {
  if (!overrides || overrides.length === 0) {
    return base;
  }
  const map = new Map(base.map((item) => [item.type, item]));
  for (const override of overrides) {
    const existing = map.get(override.type);
    if (existing) {
      map.set(override.type, mergeItem(existing, override));
    } else {
      map.set(override.type, override as T);
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
    materialCatalog: mergeById(
      baseline.materialCatalog,
      overrides.materialCatalog,
      (current, override) => ({ ...current, ...override }),
    ),
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
    sectors: mergeById(baseline.sectors, overrides.sectors, (current, override) => ({
      ...current,
      ...override,
      tags: override.tags ?? current.tags,
      polygon: override.polygon ?? current.polygon,
    })),
    planets: mergeById(baseline.planets, overrides.planets, (current, override) => ({
      ...current,
      ...override,
      tags: override.tags ?? current.tags,
      position: override.position ?? current.position,
    })),
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
    locationAssignments: mergeById(
      baseline.locationAssignments,
      overrides.locationAssignments,
      (current, override) => ({ ...current, ...override }),
    ),
    missionOffers: mergeById(
      baseline.missionOffers,
      overrides.missionOffers,
      (current, override) => ({ ...current, ...override }),
    ),
    missionTypeConfigs: mergeByType(
      baseline.missionTypeConfigs,
      overrides.missionTypeConfigs,
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
