export type Faction = "rebels" | "empire";

export type PersonnelSkill = "agent" | "diplomat" | "pilot" | "operative";
export type PersonnelStatus =
  | "idle"
  | "assigned"
  | "traveling"
  | "wounded"
  | "captured";

export type MissionStatus = "planned" | "active" | "resolved" | "failed";
export type MissionType = "logistics" | "gather-materials";

export interface Personnel {
  id: string;
  name: string;
  skills: PersonnelSkill[];
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

export interface MaterialRewardEntry {
  materialId: string;
  quantity: number;
  baseChance: number;
}

export interface MaterialRewardTable {
  id: string;
  name: string;
  entries: MaterialRewardEntry[];
}

export interface MissionMaterialRequirement {
  materialId: string;
  quantity: number;
  consumeChance: number;
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
  requiredSkills: PersonnelSkill[];
  requiredMaterials?: MissionMaterialRequirement[];
  materialRewardTableId?: string;
  durationHours: number;
  baseSuccessChance: number;
  rewards: Partial<ResourceBundle>;
  penalties?: Partial<ResourceBundle>;
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

export interface MissionTypeConfig {
  type: MissionType;
  defaultMaterialRewardTableId?: string;
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
  rewardsApplied: Partial<ResourceBundle>;
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
  materials: number;
  intel: number;
}

export interface GameState {
  faction: Faction;
  nowHours: number;
  headquartersId: string;
  resources: ResourceBundle;
  materialCatalog: MaterialCatalogItem[];
  personnel: Personnel[];
  materials: MaterialItem[];
  materialRewardTables: MaterialRewardTable[];
  missionTypeConfigs: MissionTypeConfig[];
  sectors: Sector[];
  planets: Planet[];
  locations: Location[];
  missionPlans: MissionPlan[];
  missions: MissionInstance[];
  locationAssignments: LocationAssignment[];
  missionOffers: MissionOffer[];
  travel: TravelAssignment[];
  eventLog: EventLogEntry[];
}
