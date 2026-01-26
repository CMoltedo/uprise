export type Faction = "rebels" | "empire";

export type PersonnelRole = "agent" | "diplomat" | "pilot" | "operative";
export type PersonnelStatus =
  | "idle"
  | "assigned"
  | "traveling"
  | "wounded"
  | "captured";

export type MissionStatus = "planned" | "active" | "resolved" | "failed";
export type MissionType = "logistics" | "gather-materials" | "recruit-allies";

export interface Personnel {
  id: string;
  name: string;
  roles: PersonnelRole[];
  traits?: string[];
  status: PersonnelStatus;
  locationId: string;
}

export interface Sector {
  id: string;
  name: string;
  tags: string[];
  polygon: Array<{ x: number; y: number }>;
}

export interface Planet {
  id: string;
  name: string;
  sectorId: string;
  tags: string[];
  position: { x: number; y: number };
}

export interface Location {
  id: string;
  name: string;
  tags: string[];
  planetId: string;
  position: { x: number; y: number };
  attributes: {
    resistance: number;
    healthcareFacilities: number;
    techLevel: number;
    populationDensity: number;
    customsScrutiny: number;
    patrolFrequency: number;
    garrisonStrength: number;
  };
}

export interface MaterialItem {
  id: string;
  name: string;
  quantity: number;
  tags?: string[];
}

export interface MaterialCatalogItem {
  id: string;
  name: string;
  tags?: string[];
}

export interface MissionMaterialRequirement {
  materialId: string;
  quantity: number;
  consumeChance: number;
}

export interface MissionRewardItem {
  materialId: string;
  quantity: number;
}

export interface MissionRewardEffect {
  type: string;
  data?: Record<string, unknown>;
}

export interface MissionRewardBundle {
  currency?: Partial<ResourceBundle>;
  items?: MissionRewardItem[];
  effects?: MissionRewardEffect[];
}

export type MissionAvailability =
  | { type: "global" }
  | { type: "time"; startHours: number; endHours: number };

export interface MissionPlan {
  id: string;
  name: string;
  summary: string;
  type: MissionType;
  availability?: MissionAvailability;
  requiredRoles: PersonnelRole[];
  requiredMaterials?: MissionMaterialRequirement[];
  durationHours: number;
  baseSuccessChance: number;
  rewards?: MissionRewardBundle;
  penalties?: MissionRewardBundle;
}

export interface MissionInstance {
  id: string;
  planId: string;
  locationId: string;
  assignedPersonnelIds: string[];
  status: MissionStatus;
  remainingHours: number;
  startedAtHours: number;
}

export interface LocationAssignment {
  id: string;
  locationId: string;
  planId: string;
  appearanceChance: number;
  windowHours: number;
}

export interface MissionOffer {
  id: string;
  planId: string;
  locationId: string;
  createdAtHours: number;
  expiresAtHours: number;
}

export type EventKind = "mission" | "travel";

export interface MissionEvent {
  id: string;
  kind: "mission";
  missionId: string;
  planId: string;
  status: MissionStatus;
  resolvedAtHours: number;
  success: boolean;
  personnelIds: string[];
  rewardsApplied: MissionRewardBundle;
  locationId: string;
}

export interface TravelEvent {
  id: string;
  kind: "travel";
  personnelId: string;
  fromLocationId: string;
  toLocationId: string;
  status: "started" | "arrived";
  atHours: number;
  travelHours?: number;
}

export type EventLogEntry = MissionEvent | TravelEvent;

export interface TravelAssignment {
  id: string;
  personnelId: string;
  fromLocationId: string;
  toLocationId: string;
  remainingHours: number;
  startedAtHours: number;
}

export interface ResourceBundle {
  credits: number;
  intel: number;
}

export interface GameData {
  materialCatalog: MaterialCatalogItem[];
  heroes: Personnel[];
  sectors: Sector[];
  planets: Planet[];
  locations: Location[];
  missionPlans: MissionPlan[];
  locationAssignments: LocationAssignment[];
}

export interface GameRuntime {
  faction: Faction;
  nowHours: number;
  headquartersId: string;
  resources: ResourceBundle;
  personnel: Personnel[];
  materials: MaterialItem[];
  missions: MissionInstance[];
  missionOffers: MissionOffer[];
  travel: TravelAssignment[];
  eventLog: EventLogEntry[];
}

export interface GameState {
  data: GameData;
  runtime: GameRuntime;
}
