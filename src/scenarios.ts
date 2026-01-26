import type {
  EventLogEntry,
  GameData,
  GameRuntime,
  GameState,
  Location,
  LocationAssignment,
  MaterialCatalogItem,
  MaterialItem,
  MissionOffer,
  MissionInstance,
  MissionPlan,
  Planet,
  Personnel,
  ResourceBundle,
  Sector,
  TravelAssignment,
} from "./models.js";
import materialCatalogData from "./data/materialCatalog.json";
import missionsData from "./data/missionsData.json";
import worldData from "./data/worldData.json";
import { generatePersonnel } from "./generators.js";

type WithId = { id: string };

type PartialWithId<T extends WithId> = Partial<T> & WithId;

export interface ScenarioOverrides {
  data?: {
    materialCatalog?: Array<PartialWithId<MaterialCatalogItem>>;
    heroes?: Array<PartialWithId<Personnel>>;
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

const shuffle = <T,>(items: T[]) => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
};

const buildStartingPersonnel = (baseline: GameState): Personnel[] => {
  const heroPool = baseline.data.heroes ?? [];
  const heroCount = Math.min(
    heroPool.length,
    3 + Math.floor(Math.random() * 3),
  );
  const selectedHeroes = shuffle(heroPool)
    .slice(0, heroCount)
    .map((hero) => ({
      ...hero,
      status: "idle" as const,
      locationId:
        hero.locationId ??
        baseline.runtime.headquartersId ??
        baseline.data.locations[0]?.id ??
        "",
    }));
  const randomCount = 4;
  let workingState: GameState = {
    ...baseline,
    runtime: {
      ...baseline.runtime,
      personnel: selectedHeroes,
    },
  };
  const randomPersonnel: Personnel[] = [];
  for (let i = 0; i < randomCount; i += 1) {
    const generated = generatePersonnel(workingState);
    randomPersonnel.push(generated);
    workingState = {
      ...workingState,
      runtime: {
        ...workingState.runtime,
        personnel: [...workingState.runtime.personnel, generated],
      },
    };
  }
  return [...selectedHeroes, ...randomPersonnel];
};

const loadStaticData = (): Pick<
  GameData,
  | "materialCatalog"
  | "missionPlans"
  | "locationAssignments"
  | "sectors"
  | "planets"
  | "locations"
> => ({
  materialCatalog: materialCatalogData as MaterialCatalogItem[],
  missionPlans: missionsData.missionPlans as MissionPlan[],
  locationAssignments: missionsData.locationAssignments as LocationAssignment[],
  sectors: worldData.sectors as Sector[],
  planets: worldData.planets as Planet[],
  locations: worldData.locations as Location[],
});

export const buildScenario = (
  baseline: GameState,
  overrides?: ScenarioOverrides,
): GameState => {
  const startingPersonnel =
    baseline.runtime.personnel.length > 0
      ? baseline.runtime.personnel
      : buildStartingPersonnel(baseline);
  const baseData: GameData = {
    ...baseline.data,
    ...loadStaticData(),
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
      heroes: mergeById(
        baseData.heroes,
        overrides.data?.heroes,
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
        startingPersonnel,
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
