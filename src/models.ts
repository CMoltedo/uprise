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
  | "mia"
  | "killed"
  | "resting";

export type MissionStatus = "planned" | "active" | "resolved" | "failed";
export type MissionType =
  | "logistics"
  | "gather-materials"
  | "recruit-allies"
  | "espionage"
  | "training"
  | "recovery"
  | "rescue"
  | "search";

export type IntelQuality = "low" | "med" | "high";

export interface LocationTruth {
  garrisonStrength: number;
  patrolFrequency: number;
  customsScrutiny: number;
  enemyAgents?: string[];
  enemyMissions?: string[];
  specialHooks?: string[];
  resistance?: number;
  techLevel?: number;
  populationDensity?: number;
  popularSupport?: number;
  healthcareFacilities?: number;
  /** When the next enemy action fires at this location (game hours). */
  nextEnemyActionHours?: number;
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
  /** Set when status becomes captured; used for Rescue and passive escape. */
  capturedAtHours?: number;
  capturedLocationId?: string;
  /** Set when status becomes MIA; used for Search and passive return. */
  miaAtHours?: number;
  miaLocationId?: string;
  /** Set when status becomes killed; optional for memorial/event display. */
  killedAtHours?: number;
  killedMissionId?: string;
  /** 0–100 morale score. Absent on old saves = 50 (neutral). */
  morale?: number;
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
  persistent?: boolean;
  requiredRoles: PersonnelRole[];
  requiredMaterials?: MissionMaterialRequirement[];
  creditsCost?: number;
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
  /** Base operational risk (0–1) for this mission type; used with location and agent mitigation. */
  baseRiskRating?: number;
}

export interface MissionInstance {
  id: string;
  planId: string;
  locationId: string;
  assignedPersonnelIds: string[];
  /** For rescue: captured agent id(s) to free. For search: MIA agent id(s) to find. */
  targetPersonnelIds?: string[];
  status: MissionStatus;
  remainingHours: number;
  startedAtHours: number;
  /** Set by enemy counter-op; reduces success chance at resolution. */
  enemyCounterOp?: boolean;
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

export type NarrativeOutcome =
  | { type: "resources"; credits?: number; intel?: number }
  | { type: "material"; materialId: string; quantity: number }
  | { type: "location-attribute"; key: string; delta: number }
  | { type: "nothing" };

export interface NarrativeChoice {
  id: string;
  label: string;
  flavor: string;
  outcomes: NarrativeOutcome[];
  /** 0–1 chance the choice succeeds; absent means always succeeds. */
  successChance?: number;
  /** Outcomes applied when the roll fails; defaults to no effect. */
  failureOutcomes?: NarrativeOutcome[];
}

export interface NarrativeEventDef {
  id: string;
  category: "windfall" | "threat" | "opportunity" | "complication";
  title: string;
  body: string;
  choices: NarrativeChoice[];
  weight?: number;
}

export interface NarrativePending {
  id: string;
  eventId: string;
  locationId: string;
  triggeredAtHours: number;
  expiresAtHours: number;
}

export interface NarrativeEventLog {
  id: string;
  kind: "narrative";
  eventId: string;
  choiceId: string;
  locationId: string;
  resolvedAtHours: number;
  outcomes: NarrativeOutcome[];
  /** Present when the choice had a successChance roll: true = succeeded, false = failed. */
  choiceSuccess?: boolean;
}

export type EventKind = "mission" | "travel" | "enemy-action" | "narrative";

export type EnemyActionKind =
  | "patrol-increase"
  | "propaganda"
  | "arrest"
  | "counter-op";

export interface EnemyActionEvent {
  id: string;
  kind: "enemy-action";
  locationId: string;
  action: EnemyActionKind;
  atHours: number;
  /** Present for arrest: the captured personnel id. */
  personnelId?: string;
  /** Present for counter-op: the targeted mission id. */
  missionId?: string;
}


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
  /** For rescue/search missions: ids of personnel successfully freed or found. */
  rescuedPersonnelIds?: string[];
  /** For rescue/search missions: what happened to target personnel when the mission failed. */
  targetAdverseOutcomes?: Array<{
    personnelId: string;
    outcome: "moved" | "executed";
    /** Present when outcome === "moved": the new location id. */
    newLocationId?: string;
  }>;
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
  /** Present on arrival if a hazard was encountered en route. */
  hazard?: "wounded" | "captured";
}

export type EventLogEntry = MissionEvent | TravelEvent | EnemyActionEvent | NarrativeEventLog;

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
  narrativePending?: NarrativePending[];
  /** "active" while running; "victory" or "defeat" when the game ends. Absent on old saves = active. */
  phase?: "active" | "victory" | "defeat";
  /** Short key describing why the game ended, for display. */
  phaseReason?: "popular-support" | "all-agents-gone" | "hq-lost";
}

export interface GameState {
  data: GameData;
  runtime: GameRuntime;
}
