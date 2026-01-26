import type {
  EventLogEntry,
  GameData,
  GameRuntime,
  GameState,
  Location,
  LocationAssignment,
  MaterialCatalogItem,
  MaterialItem,
  MaterialRewardTable,
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
import materialCatalogData from "./data/materialCatalog.json";
import worldData from "./data/worldData.json";

type WithId = { id: string };
type WithType = { type: string };

type PartialWithId<T extends WithId> = Partial<T> & WithId;
type PartialWithType<T extends WithType> = Partial<T> & WithType;

export interface ScenarioOverrides {
  data?: {
    materialCatalog?: Array<PartialWithId<MaterialCatalogItem>>;
    materialRewardTables?: Array<PartialWithId<MaterialRewardTable>>;
    missionTypeConfigs?: Array<PartialWithType<MissionTypeConfig>>;
    sectors?: Array<PartialWithId<Sector>>;
    planets?: Array<PartialWithId<Planet>>;
    locations?: Array<PartialWithId<Location>>;
    missionPlans?: Array<PartialWithId<MissionPlan>>;
    locationAssignments?: Array<PartialWithId<LocationAssignment>>;
  };
  runtime?: {
    faction?: GameState["runtime"]["faction"];
    nowHours?: number;
    headquartersId?: string;
    resources?: Partial<ResourceBundle>;
    personnel?: Array<PartialWithId<Personnel>>;
    materials?: Array<PartialWithId<MaterialItem>>;
    missions?: Array<PartialWithId<MissionInstance>>;
    missionOffers?: Array<PartialWithId<MissionOffer>>;
    travel?: Array<PartialWithId<TravelAssignment>>;
    eventLog?: Array<PartialWithId<EventLogEntry>>;
  };
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
  position: override.position ?? current.position,
  attributes: {
    ...current.attributes,
    ...override.attributes,
  },
});

export const buildScenario = (
  baseline: GameState,
  overrides?: ScenarioOverrides,
): GameState => {
  const baseData: GameData = {
    ...baseline.data,
    materialCatalog: materialCatalogData as MaterialCatalogItem[],
    sectors: worldData.sectors as Sector[],
    planets: worldData.planets as Planet[],
    locations: worldData.locations as Location[],
  };
  if (!overrides) {
    return {
      data: baseData,
      runtime: baseline.runtime,
    };
  }

  return {
    data: {
      ...baseData,
      materialCatalog: mergeById(
        baseData.materialCatalog,
        overrides.data?.materialCatalog,
        (current, override) => ({ ...current, ...override }),
      ),
      materialRewardTables: mergeById(
        baseData.materialRewardTables,
        overrides.data?.materialRewardTables,
        (current, override) => ({ ...current, ...override }),
      ),
      missionTypeConfigs: mergeByType(
        baseData.missionTypeConfigs,
        overrides.data?.missionTypeConfigs,
        (current, override) => ({ ...current, ...override }),
      ),
      sectors: mergeById(
        baseData.sectors,
        overrides.data?.sectors,
        (current, override) => ({
          ...current,
          ...override,
          tags: override.tags ?? current.tags,
          polygon: override.polygon ?? current.polygon,
        }),
      ),
      planets: mergeById(
        baseData.planets,
        overrides.data?.planets,
        (current, override) => ({
          ...current,
          ...override,
          tags: override.tags ?? current.tags,
          position: override.position ?? current.position,
        }),
      ),
      locations: mergeById(
        baseData.locations,
        overrides.data?.locations,
        mergeLocation,
      ),
      missionPlans: mergeById(
        baseData.missionPlans,
        overrides.data?.missionPlans,
        (current, override) => ({ ...current, ...override }),
      ),
      locationAssignments: mergeById(
        baseData.locationAssignments,
        overrides.data?.locationAssignments,
        (current, override) => ({ ...current, ...override }),
      ),
    },
    runtime: {
      ...baseline.runtime,
      faction: overrides.runtime?.faction ?? baseline.runtime.faction,
      nowHours: overrides.runtime?.nowHours ?? baseline.runtime.nowHours,
      headquartersId:
        overrides.runtime?.headquartersId ?? baseline.runtime.headquartersId,
      resources: {
        ...baseline.runtime.resources,
        ...overrides.runtime?.resources,
      },
      personnel: mergeById(
        baseline.runtime.personnel,
        overrides.runtime?.personnel,
        (current, override) => ({ ...current, ...override }),
      ),
      materials: mergeById(
        baseline.runtime.materials,
        overrides.runtime?.materials,
        (current, override) => ({ ...current, ...override }),
      ),
      missions: mergeById(
        baseline.runtime.missions,
        overrides.runtime?.missions,
        (current, override) => ({ ...current, ...override }),
      ),
      missionOffers: mergeById(
        baseline.runtime.missionOffers,
        overrides.runtime?.missionOffers,
        (current, override) => ({ ...current, ...override }),
      ),
      travel: mergeById(
        baseline.runtime.travel,
        overrides.runtime?.travel,
        (current, override) => ({ ...current, ...override }),
      ),
      eventLog: mergeById(
        baseline.runtime.eventLog,
        overrides.runtime?.eventLog,
        (current, override) => ({ ...current, ...override }) as EventLogEntry,
      ),
    },
  };
};
