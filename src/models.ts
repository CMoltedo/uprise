export type Faction = "rebels" | "empire";

export type PersonnelRole = "agent" | "diplomat" | "pilot" | "operative";
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
  role: PersonnelRole;
  status: PersonnelStatus;
  locationId: string;
}

export interface Location {
  id: string;
  name: string;
  tags: string[];
  missionPlanIds?: string[];
  sector: {
    x: number;
    y: number;
  };
  position: {
    x: number;
    y: number;
  };
  immutable: {
    secrecy: number;
    resources: number;
    willingness: number;
  };
  mutable: {
    support: number;
    suspicion: number;
    productionCapacity: number;
  };
  subLocations?: Array<{
    id: string;
    name: string;
    position: {
      x: number;
      y: number;
    };
  }>;
}

export interface MaterialItem {
  id: string;
  name: string;
  quantity: number;
  tags?: string[];
}

export interface MissionMaterialRequirement {
  materialId: string;
  quantity: number;
  consumeChance: number;
}

export type MissionAvailability =
  | { type: "location"; locationId: string }
  | { type: "global" }
  | { type: "time"; startHours: number; endHours: number };

export interface MissionPlan {
  id: string;
  name: string;
  summary: string;
  type: MissionType;
  availability: MissionAvailability;
  requiredRoles: PersonnelRole[];
  requiredMaterials?: MissionMaterialRequirement[];
  durationHours: number;
  baseSuccessChance: number;
  rewards: Partial<ResourceBundle>;
  penalties?: Partial<ResourceBundle>;
}

export interface MissionInstance {
  id: string;
  planId: string;
  assignedPersonnelIds: string[];
  status: MissionStatus;
  remainingHours: number;
  startedAtHours: number;
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
}

export interface TravelEvent {
  id: string;
  kind: "travel";
  personnelId: string;
  fromLocationId: string;
  toLocationId: string;
  status: "started" | "arrived";
  atHours: number;
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
  personnel: Personnel[];
  materials: MaterialItem[];
  locations: Location[];
  missionPlans: MissionPlan[];
  missions: MissionInstance[];
  travel: TravelAssignment[];
  eventLog: EventLogEntry[];
}
