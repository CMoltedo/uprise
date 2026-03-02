export type Faction = "rebels" | "empire";

export type PersonnelRole =
  | "diplomacy"
  | "espionage"
  | "combat"
  | "operations"
  | "command"
  | "knowledge";
export type PersonnelStatus =
  | "idle"
  | "assigned"
  | "traveling"
  | "wounded"
  | "captured"
  | "resting";

export type MissionStatus = "planned" | "active" | "resolved" | "failed";
export type MissionType =
  | "logistics"
  | "gather-materials"
  | "recruit-allies"
  | "espionage"
  | "training"
  | "recovery";

export type IntelQuality = "low" | "med" | "high";

export interface LocationTruth {
  garrisonStrength: number;
  patrolFrequency: number;
  customsScrutiny: number;
  enemyAgents?: string[];
  enemyMissions?: string[];
  specialHooks?: string[];
}

export interface IntelSnapshot {
  observedAtHours: number;
  value: number | string[];
  quality: IntelQuality;
}

export interface PlayerKnowledge {
  byLocation: Record<string, Record<string, IntelSnapshot>>;
}

export interface Personnel {
  id: string;
  name: string;
  roles: PersonnelRole[];
  /** @deprecated Use immutableTraits + mutableTraits. Combined for modifier math when present. */
  traits?: string[];
  /** Immutable personality/class traits (1–3 at creation, never change). */
  immutableTraits?: string[];
  /** Mutable traits gained from missions, capture, injury, recovery. */
  mutableTraits?: string[];
  status: PersonnelStatus;
  locationId: string;
  /** Set when status becomes wounded; used for passive healing. */
  woundedAtHours?: number;
  /** Set when status becomes resting; cleared when transitioning to idle. */
  restingUntilHours?: number;
  roleLevels?: Partial<Record<PersonnelRole, number>>;
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
  /** When true, location is excluded from mission offers, travel destinations, and selection (for testing). */
  disabled?: boolean;
  attributes: {
    resistance: number;
    healthcareFacilities: number;
    techLevel: number;
    populationDensity: number;
    customsScrutiny: number;
    patrolFrequency: number;
    garrisonStrength: number;
    popularSupport: number;
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
  locationAttributes?: Partial<Record<keyof Location["attributes"], number>>;
  /** When location attributes were applied, the prior and new value per attribute (for mission report). */
  locationAttributeChanges?: Partial<Record<keyof Location["attributes"], { before: number; after: number }>>;
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
  intelRewards?: {
    target: "location";
    keys: string[];
    quality: IntelQuality;
  };
  requiresKnownHook?: string;
  trainingReward?: { roleId: PersonnelRole };
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
  intelReport?: { summary: string; keys: string[] };
  roleGained?: Array<{ personnelId: string; roleId: string; newLevel?: number }>;
  traitGained?: Array<{ personnelId: string; traitId: string }>;
  /** For successful recruit-allies missions: ids of newly recruited personnel. */
  recruitedPersonnelIds?: string[];
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
  locationTruth?: Record<string, LocationTruth>;
  knowledge?: PlayerKnowledge;
  trainingAttemptsWithoutGain?: Record<string, Record<string, number>>;
}

export interface GameState {
  data: GameData;
  runtime: GameRuntime;
}
