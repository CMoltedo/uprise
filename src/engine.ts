import type {
  GameState,
  Location,
  MaterialCatalogItem,
  MaterialItem,
  MissionEvent,
  TravelEvent,
  MissionOffer,
  LocationAssignment,
  MissionInstance,
  MissionPlan,
  MissionMaterialRequirement,
  Personnel,
  PersonnelRole,
  PersonnelStatus,
  ResourceBundle,
  MissionRewardBundle,
  MissionRewardItem,
  TravelAssignment,
  LocationTruth,
  IntelSnapshot,
  IntelQuality,
  PlayerKnowledge,
  EnemyActionEvent,
  EnemyActionKind,
  NarrativeEventDef,
  NarrativePending,
  NarrativeEventLog,
  NarrativeOutcome,
} from "./models.js";
import { generatePersonnel } from "./generators.js";
import balance from "./data/balance.json";
import intelDefsData from "./data/intel_defs.json";
import narrativeEventsData from "./data/narrativeEvents.json";

interface IntelDefEntry {
  staleAfterHours: number;
  rangePadByQuality?: { low?: number; med?: number; high?: number };
}
const intelDefs: Record<string, IntelDefEntry> = (intelDefsData as { keys: Record<string, IntelDefEntry> }).keys ?? {};

const clampChance = (chance: number) => Math.max(0, Math.min(1, chance));

const getModifierSummary = (
  entries: string[],
  modifiers: Record<string, number> | undefined,
) => {
  let bonus = 0;
  let penalty = 0;
  const bonuses: string[] = [];
  const penalties: string[] = [];

  for (const entry of entries) {
    const modifier = modifiers?.[entry] ?? 0;
    if (modifier > 0) {
      bonus += modifier;
      bonuses.push(entry);
    } else if (modifier < 0) {
      penalty += Math.abs(modifier);
      penalties.push(entry);
    }
  }

  return {
    bonus,
    penalty,
    total: bonus - penalty,
    bonuses,
    penalties,
  };
};

const getPersonnelTraits = (personnel: Personnel[]) =>
  personnel.flatMap((person) =>
    (person.immutableTraits ?? person.traits ?? []).concat(
      person.mutableTraits ?? [],
    ),
  );

/** All traits for one person (for display / modifier). */
export const getTraitsForPerson = (person: Personnel): string[] =>
  (person.immutableTraits ?? person.traits ?? []).concat(
    person.mutableTraits ?? [],
  );

/** Total trait count for one person (cap 8). */
export const getPersonnelTraitCount = (person: Personnel): number =>
  (person.immutableTraits ?? person.traits ?? []).length +
  (person.mutableTraits ?? []).length;

const MAX_TRAITS = (balance as { maxPersonnelTraits?: number }).maxPersonnelTraits ?? 8;
const MAX_PERSONNEL_ROLES = (balance as { maxPersonnelRoles?: number }).maxPersonnelRoles ?? 3;
const MUTABLE_BASE_CHANCE = (balance as { mutableTraitBaseChance?: number }).mutableTraitBaseChance ?? 0.15;
const DIMINISH_FACTOR = (balance as { mutableTraitDiminishFactor?: number }).mutableTraitDiminishFactor ?? 0.15;

/** Chance multiplier for gaining a new mutable trait (decreases as trait count approaches max). */
export const getMutableTraitGainChanceMultiplier = (person: Personnel): number => {
  const n = getPersonnelTraitCount(person);
  if (n >= MAX_TRAITS) return 0;
  return Math.max(0.1, Math.min(1, 1 - (n - 4) * DIMINISH_FACTOR));
};

const MUTABLE_POOL: string[] = (balance as { mutableTraits?: string[] }).mutableTraits ?? [];

/** Try to add one mutable trait to a person; returns updated person if added, same ref if not. */
function tryAddMutableTrait(
  person: Personnel,
  candidateTraits: string[],
  rng: () => number = Math.random,
): Personnel {
  if (getPersonnelTraitCount(person) >= MAX_TRAITS) return person;
  const existing = new Set(
    (person.immutableTraits ?? person.traits ?? []).concat(
      person.mutableTraits ?? [],
    ),
  );
  const available = candidateTraits.filter((t) => !existing.has(t));
  if (available.length === 0) return person;
  const chance =
    MUTABLE_BASE_CHANCE * getMutableTraitGainChanceMultiplier(person);
  if (rng() >= chance) return person;
  const trait = available[Math.floor(rng() * available.length)];
  return {
    ...person,
    mutableTraits: [...(person.mutableTraits ?? []), trait],
  };
}

const getPersonnelRoles = (personnel: Personnel[]) =>
  personnel.flatMap((person) => person.roles);

/**
 * Rolls for a post-mission role level-up for each assigned person.
 * Chance diminishes as level approaches maxRoleLevel (harder to advance at high levels).
 */
const applyPostMissionLevelGain = (
  personnel: Personnel[],
  assignedPersonnelIds: string[],
  maxRoleLevel: number | undefined,
  baseChance: number,
): { personnel: Personnel[]; roleGained: Array<{ personnelId: string; roleId: string; newLevel?: number }> } => {
  let next = personnel;
  const roleGained: Array<{ personnelId: string; roleId: string; newLevel?: number }> = [];
  for (const personnelId of assignedPersonnelIds) {
    const person = next.find((p) => p.id === personnelId);
    if (!person || person.roles.length === 0) continue;
    const roleId = person.roles[Math.floor(Math.random() * person.roles.length)] as PersonnelRole;
    const currentLevel = person.roleLevels?.[roleId] ?? 1;
    if (maxRoleLevel != null && currentLevel >= maxRoleLevel) continue;
    // Diminishing returns: full chance at level 1, 10% of base chance near max
    const diminish = Math.max(0.1, 1 - (currentLevel - 1) / (maxRoleLevel ?? 10));
    const effectiveChance = baseChance * diminish;
    if (Math.random() >= effectiveChance) continue;
    const newLevel = currentLevel + 1;
    next = next.map((p) =>
      p.id !== personnelId ? p : { ...p, roleLevels: { ...p.roleLevels, [roleId]: newLevel } },
    );
    roleGained.push({ personnelId, roleId, newLevel });
  }
  return { personnel: next, roleGained };
};

export const getTraitSuccessModifier = (personnel: Personnel[]) => {
  const traitModifiers = balance.traitSuccessModifiers as
    | Record<string, number>
    | undefined;
  return getModifierSummary(getPersonnelTraits(personnel), traitModifiers);
};

export const getRoleSuccessModifier = (personnel: Personnel[]) => {
  const roleModifiers = balance.roleSuccessModifiers as
    | Record<string, number>
    | undefined;
  return getModifierSummary(getPersonnelRoles(personnel), roleModifiers);
};

export const getMissionRewardModifier = (personnel: Personnel[]) => {
  const rewardModifiers = balance.roleRewardModifiers as
    | Record<string, number>
    | undefined;
  return getModifierSummary(getPersonnelRoles(personnel), rewardModifiers);
};

export const getMissionConsumeModifier = (personnel: Personnel[]) => {
  const consumeModifiers = balance.roleConsumeModifiers as
    | Record<string, number>
    | undefined;
  return getModifierSummary(getPersonnelRoles(personnel), consumeModifiers);
};

const getPersonnelMorale = (person: Personnel): number => {
  if (person.morale != null) return person.morale;
  const bal = balance as unknown as Record<string, number>;
  const def = bal.moraleDefault ?? 50;
  const traitBase =
    (balance as unknown as { traitMoraleBase?: Record<string, number> }).traitMoraleBase ?? {};
  const traits = getTraitsForPerson(person);
  const offset = traits.reduce((sum, t) => sum + (traitBase[t] ?? 0), 0);
  return Math.max(0, Math.min(100, def + offset));
};

const applyMoraleChange = (person: Personnel, delta: number): Personnel => {
  const bal = balance as unknown as Record<string, number>;
  const current = getPersonnelMorale(person);
  const next = Math.max(bal.moraleMin ?? 0, Math.min(bal.moraleMax ?? 100, current + delta));
  return { ...person, morale: next };
};

export const getMoraleSuccessModifier = (person: Personnel): number => {
  const bal = balance as unknown as Record<string, number>;
  const m = getPersonnelMorale(person);
  const breaking = bal.moraleBreakingPointThreshold ?? 15;
  const warn = bal.moraleWarnThreshold ?? 30;
  const high = bal.moraleHighThreshold ?? 70;
  if (m <= breaking) return bal.moraleSuccessModifierBreaking ?? -0.1;
  if (m < warn) return bal.moraleSuccessModifierLow ?? -0.05;
  if (m >= high) return bal.moraleSuccessModifierHigh ?? 0.03;
  return 0;
};

export const getMissionSuccessChance = (
  plan: MissionPlan,
  personnel: Personnel[],
) => {
  const baseChance = plan.baseSuccessChance;
  const traitModifier = getTraitSuccessModifier(personnel);
  const roleModifier = getRoleSuccessModifier(personnel);
  const totalModifier = traitModifier.total + roleModifier.total;
  const moraleModifier =
    personnel.reduce((sum, p) => sum + getMoraleSuccessModifier(p), 0) /
    Math.max(1, personnel.length);
  const chance = clampChance(baseChance + totalModifier + moraleModifier);
  return {
    chance,
    baseChance,
    traitModifier,
    roleModifier,
    totalModifier,
    moraleModifier,
  };
};

/** Default base risk by mission type when plan.baseRiskRating is missing. */
const DEFAULT_BASE_RISK_BY_TYPE: Partial<Record<string, number>> = {
  recovery: 0,
  training: 0.05,
  logistics: 0.1,
  "gather-materials": 0.15,
  "recruit-allies": 0.1,
  espionage: 0.25,
  rescue: 0.5,
  search: 0.2,
};

export const getBaseRiskRating = (plan: MissionPlan): number => {
  if (plan.baseRiskRating !== undefined && plan.baseRiskRating !== null) {
    return Math.max(0, Math.min(1, plan.baseRiskRating));
  }
  return Math.max(0, Math.min(1, DEFAULT_BASE_RISK_BY_TYPE[plan.type] ?? 0.15));
};

/** Location risk factor (multiplier). Hostile attributes increase, friendly decrease. Returns ~0.5–1.5. */
export const getLocationRiskFactor = (
  state: GameState,
  locationId: string,
): number => {
  const location = getLocation(state, locationId);
  if (!location) return 1;
  const weights = (balance as { riskLocationWeights?: Record<string, number> }).riskLocationWeights ?? {};
  const scale = (balance as { riskLocationScale?: number }).riskLocationScale ?? 1.5;
  let contribution = 0;
  const attrs = location.attributes as Record<string, number>;
  for (const [key, weight] of Object.entries(weights)) {
    const value = attrs[key] ?? 0;
    contribution += weight * (value / 100);
  }
  const multiplier = 1 + contribution * scale;
  return Math.max(0.5, Math.min(1.5, multiplier));
};

/** Trait risk modifier total for personnel (positive = more risk, negative = less risk). */
export const getTraitRiskModifier = (personnel: Personnel[]): number => {
  const traitModifiers = (balance as { traitRiskModifiers?: Record<string, number> }).traitRiskModifiers;
  if (!traitModifiers) return 0;
  const traits = getPersonnelTraits(personnel);
  let total = 0;
  for (const t of traits) {
    total += traitModifiers[t] ?? 0;
  }
  return total;
};

/** Agent mitigation reduces effective risk (role levels + traits). Returns reduction in [0, 1]. */
export const getAgentRiskMitigation = (
  personnel: Personnel[],
  plan: MissionPlan,
): number => {
  const perLevel = (balance as { riskRoleLevelReductionPerLevel?: number }).riskRoleLevelReductionPerLevel ?? 0.02;
  const rolesToCheck = plan.requiredRoles.length > 0 ? plan.requiredRoles : (balance as { personnelRoles?: string[] }).personnelRoles ?? [];
  let levelBonus = 0;
  for (const person of personnel) {
    const levels = person.roleLevels ?? {};
    for (const roleId of rolesToCheck) {
      const level = levels[roleId as PersonnelRole] ?? 1;
      if (level > 1) levelBonus += (level - 1) * perLevel;
    }
  }
  const traitMod = getTraitRiskModifier(personnel);
  const traitReduction = -traitMod;
  return Math.max(0, Math.min(1, levelBonus + traitReduction));
};

/** Effective operational risk [0, 1] for a mission at a location with given personnel. */
export const getMissionOperationalRisk = (
  state: GameState,
  plan: MissionPlan,
  locationId: string,
  personnel: Personnel[],
): number => {
  const base = getBaseRiskRating(plan);
  const locationFactor = getLocationRiskFactor(state, locationId);
  const mitigation = getAgentRiskMitigation(personnel, plan);
  const raw = base * locationFactor - mitigation;
  return Math.max(0, Math.min(1, raw));
};

export interface OperationalRiskBreakdown {
  risk: number;
  base: number;
  locationFactor: number;
  mitigation: number;
}

/** Like getMissionOperationalRisk but returns the breakdown components alongside the final value. */
export const getMissionOperationalRiskBreakdown = (
  state: GameState,
  plan: MissionPlan,
  locationId: string,
  personnel: Personnel[],
): OperationalRiskBreakdown => {
  const base = getBaseRiskRating(plan);
  const locationFactor = getLocationRiskFactor(state, locationId);
  const mitigation = getAgentRiskMitigation(personnel, plan);
  const raw = base * locationFactor - mitigation;
  return {
    risk: Math.max(0, Math.min(1, raw)),
    base,
    locationFactor,
    mitigation,
  };
};

const mergeResources = (
  base: ResourceBundle,
  delta?: Partial<ResourceBundle>,
): ResourceBundle => {
  if (!delta) {
    return { ...base };
  }
  return {
    credits: base.credits + (delta.credits ?? 0),
    intel: base.intel + (delta.intel ?? 0),
  };
};

const applyRewardModifier = (
  rewards: Partial<ResourceBundle>,
  modifier: number,
): Partial<ResourceBundle> => {
  if (!modifier) {
    return rewards;
  }
  const multiplier = 1 + modifier;
  return {
    credits:
      rewards.credits !== undefined
        ? Math.round(rewards.credits * multiplier)
        : undefined,
    intel:
      rewards.intel !== undefined
        ? Math.round(rewards.intel * multiplier)
        : undefined,
  };
};

export const getLocation = (state: GameState, locationId: string) =>
  state.data.locations.find((location) => location.id === locationId);

/** True when location exists and has disabled === true. Used to exclude from offers and UI. */
export const isLocationDisabled = (state: GameState, locationId: string): boolean => {
  const loc = getLocation(state, locationId);
  return loc?.disabled === true;
};

/** Recovery mission duration in hours from location tech and healthcare; higher = faster healing. */
export const getRecoveryDurationHours = (state: GameState, locationId: string): number => {
  if (locationId === "galaxy") {
    return (balance as { recoveryBaseHours?: number }).recoveryBaseHours ?? 48;
  }
  const location = getLocation(state, locationId);
  if (!location) {
    return (balance as { recoveryBaseHours?: number }).recoveryBaseHours ?? 48;
  }
  const base = (balance as { recoveryBaseHours?: number }).recoveryBaseHours ?? 48;
  const techFactor = (balance as { recoveryTechFactor?: number }).recoveryTechFactor ?? 0.5;
  const healthFactor = (balance as { recoveryHealthcareFactor?: number }).recoveryHealthcareFactor ?? 0.5;
  const { techLevel, healthcareFacilities } = location.attributes;
  const scale = 100 / (100 + techFactor * techLevel + healthFactor * healthcareFacilities);
  return Math.max(1, Math.round(base * scale));
};

/** Min and max duration in hours for a training plan (base duration × multiplier range). */
export const getTrainingDurationRange = (plan: MissionPlan): { minHours: number; maxHours: number } => {
  const base = plan.durationHours;
  const minMult = (balance as { trainingDurationMultiplierMin?: number }).trainingDurationMultiplierMin ?? 4;
  const maxMult = (balance as { trainingDurationMultiplierMax?: number }).trainingDurationMultiplierMax ?? 8;
  return {
    minHours: Math.round(base * minMult),
    maxHours: Math.round(base * maxMult),
  };
};

export const getLocationTruth = (state: GameState, locationId: string): LocationTruth => {
  const stored = state.runtime.locationTruth?.[locationId];
  if (stored) {
    return stored;
  }
  const location = getLocation(state, locationId);
  if (!location) {
    return {
      garrisonStrength: 0,
      patrolFrequency: 0,
      customsScrutiny: 0,
      enemyAgents: [],
      enemyMissions: [],
      specialHooks: [],
      resistance: 0,
      techLevel: 0,
      populationDensity: 0,
      popularSupport: 0,
      healthcareFacilities: 0,
    };
  }
  const a = location.attributes;
  return {
    garrisonStrength: a.garrisonStrength,
    patrolFrequency: a.patrolFrequency,
    customsScrutiny: a.customsScrutiny,
    enemyAgents: [],
    enemyMissions: [],
    specialHooks: [],
    resistance: a.resistance,
    techLevel: a.techLevel,
    populationDensity: a.populationDensity,
    popularSupport: a.popularSupport,
    healthcareFacilities: a.healthcareFacilities,
  };
};

/** Planetary popular support: average of popularSupport across enabled locations on the planet. Returns 0 if planet has no enabled locations. */
export const getPlanetPopularSupport = (state: GameState, planetId: string): number => {
  const locations = state.data.locations.filter(
    (loc) => loc.planetId === planetId && !loc.disabled,
  );
  if (locations.length === 0) return 0;
  const sum = locations.reduce((acc, loc) => acc + loc.attributes.popularSupport, 0);
  return sum / locations.length;
};

export type IntelDisplayStatus = "unknown" | "known" | "stale";

export type IntelDisplayResult =
  | { status: "unknown" }
  | {
      status: "known" | "stale";
      value: number | string[];
      observedAtHours: number;
      ageHours: number;
    };

export const getIntelDisplay = (
  state: GameState,
  locationId: string,
  intelKey: string,
): IntelDisplayResult => {
  const snapshot = state.runtime.knowledge?.byLocation?.[locationId]?.[intelKey];
  if (!snapshot) {
    return { status: "unknown" };
  }
  const nowHours = state.runtime.nowHours;
  const ageHours = nowHours - snapshot.observedAtHours;
  const def = intelDefs[intelKey];
  const staleAfterHours = def?.staleAfterHours ?? 24;
  if (ageHours > staleAfterHours) {
    return {
      status: "stale",
      value: snapshot.value,
      observedAtHours: snapshot.observedAtHours,
      ageHours,
    };
  }
  return {
    status: "known",
    value: snapshot.value,
    observedAtHours: snapshot.observedAtHours,
    ageHours,
  };
};

export const getMissionPlan = (state: GameState, planId: string) =>
  state.data.missionPlans.find((plan) => plan.id === planId);

export const getPersonnel = (state: GameState, personnelId: string) =>
  state.runtime.personnel.find((person) => person.id === personnelId);

export const getMaterialCatalogItem = (
  state: GameState,
  materialId: string,
): MaterialCatalogItem | undefined =>
  state.data.materialCatalog.find((item) => item.id === materialId);

const hasMaterials = (
  state: GameState,
  requirements?: MissionMaterialRequirement[],
): string[] => {
  const errors: string[] = [];
  if (!requirements || requirements.length === 0) {
    return errors;
  }
  for (const requirement of requirements) {
    const material = state.runtime.materials.find(
      (item) => item.id === requirement.materialId,
    );
    if (!material) {
      errors.push(`Missing material ${requirement.materialId}`);
      continue;
    }
    if (material.quantity < requirement.quantity) {
      errors.push(
        `Need ${requirement.quantity} ${material.name}, have ${material.quantity}`,
      );
    }
  }
  return errors;
};

const hasCredits = (state: GameState, plan: MissionPlan): string[] => {
  if (!plan.creditsCost || plan.creditsCost <= 0) return [];
  if (state.runtime.resources.credits < plan.creditsCost)
    return [`Need ${plan.creditsCost} credits (have ${state.runtime.resources.credits})`];
  return [];
};

const consumeMaterials = (
  materials: MaterialItem[],
  requirements?: MissionMaterialRequirement[],
  consumeModifier = 0,
): MaterialItem[] => {
  if (!requirements || requirements.length === 0) {
    return materials;
  }

  return materials.map((item) => {
    const requirement = requirements.find(
      (req) => req.materialId === item.id,
    );
    if (!requirement) {
      return item;
    }

    const roll = Math.random();
    const effectiveChance = clampChance(requirement.consumeChance + consumeModifier);
    const consume = roll <= effectiveChance;
    const consumedQty = consume ? requirement.quantity : 0;
    return {
      ...item,
      quantity: Math.max(0, item.quantity - consumedQty),
    };
  });
};

const applyRewardItems = (
  state: GameState,
  items: MissionRewardItem[] | undefined,
  rewardModifier: number,
  direction: 1 | -1,
): MaterialItem[] => {
  if (!items || items.length === 0) {
    return state.runtime.materials;
  }
  const multiplier = direction === 1 ? 1 + rewardModifier : 1;
  const itemMap = new Map(
    state.runtime.materials.map((item) => [item.id, { ...item }]),
  );
  for (const item of items) {
    const baseQty = Math.round(item.quantity * multiplier);
    const delta = direction * baseQty;
    if (delta === 0) {
      continue;
    }
    const existing = itemMap.get(item.materialId);
    if (existing) {
      existing.quantity = Math.max(0, existing.quantity + delta);
      itemMap.set(item.materialId, existing);
      continue;
    }
    const catalogItem = getMaterialCatalogItem(state, item.materialId);
    itemMap.set(item.materialId, {
      id: item.materialId,
      name: catalogItem?.name ?? item.materialId,
      quantity: Math.max(0, delta),
      tags: catalogItem?.tags,
    });
  }
  return Array.from(itemMap.values());
};

const applyRewardBundle = (
  state: GameState,
  bundle: MissionRewardBundle | undefined,
  rewardModifier: number,
  direction: 1 | -1,
) => {
  if (!bundle) {
    return {
      resources: state.runtime.resources,
      materials: state.runtime.materials,
      applied: {},
    };
  }
  const currency = bundle.currency ?? {};
  const appliedCurrency =
    direction === 1 ? applyRewardModifier(currency, rewardModifier) : currency;
  const nextResources = mergeResources(state.runtime.resources, appliedCurrency);
  const nextMaterials = applyRewardItems(
    state,
    bundle.items,
    rewardModifier,
    direction,
  );
  const appliedItems =
    bundle.items && bundle.items.length > 0
      ? bundle.items.map((item) => ({
          ...item,
          quantity:
            direction *
            (direction === 1
              ? Math.round(item.quantity * (1 + rewardModifier))
              : item.quantity),
        }))
      : undefined;
  return {
    resources: nextResources,
    materials: nextMaterials,
    applied: {
      currency: appliedCurrency,
      items: appliedItems,
      effects: bundle.effects,
    },
  };
};

const applyRecruitRewards = (
  state: GameState,
  locationId: string,
  count: number,
): GameState => {
  if (count <= 0) {
    return state;
  }
  const nextPersonnel = [...state.runtime.personnel];
  let workingState: GameState = {
    ...state,
    runtime: { ...state.runtime, personnel: nextPersonnel },
  };
  for (let i = 0; i < count; i += 1) {
    const recruit = generatePersonnel(workingState, { locationId });
    nextPersonnel.push(recruit);
    workingState = {
      ...workingState,
      runtime: { ...workingState.runtime, personnel: nextPersonnel },
    };
  }
  return workingState;
};

const LOCATION_ATTRIBUTE_KEYS: (keyof Location["attributes"])[] = [
  "resistance",
  "healthcareFacilities",
  "techLevel",
  "populationDensity",
  "customsScrutiny",
  "patrolFrequency",
  "garrisonStrength",
  "popularSupport",
];

/** Apply location attribute deltas at a location; update knowledge for each changed key. Returns null if no-op. */
function applyLocationAttributeDeltas(
  state: GameState,
  locationId: string,
  deltas: Partial<Record<keyof Location["attributes"], number>>,
  nowHours: number,
): {
  nextLocations: Location[];
  nextKnowledge: PlayerKnowledge;
  appliedLocationAttributes: Partial<Record<keyof Location["attributes"], number>>;
  locationAttributeChanges: Partial<Record<keyof Location["attributes"], { before: number; after: number }>>;
} | null {
  if (locationId === "galaxy" || !deltas || Object.keys(deltas).length === 0) {
    return null;
  }
  const location = getLocation(state, locationId);
  if (!location) return null;

  const attrs = { ...location.attributes };
  const applied: Partial<Record<keyof Location["attributes"], number>> = {};
  const changes: Partial<Record<keyof Location["attributes"], { before: number; after: number }>> = {};
  for (const key of LOCATION_ATTRIBUTE_KEYS) {
    const delta = deltas[key];
    if (delta === undefined) continue;
    const current = attrs[key];
    if (typeof current !== "number") continue;
    const next = Math.max(0, Math.min(100, current + delta));
    attrs[key] = next;
    applied[key] = delta;
    changes[key] = { before: current, after: next };
  }
  if (Object.keys(applied).length === 0) return null;

  const nextLocations = state.data.locations.map((loc) =>
    loc.id === locationId ? { ...loc, attributes: attrs } : loc,
  );

  const byLocation = state.runtime.knowledge?.byLocation ?? {};
  const locKnowledge = { ...(byLocation[locationId] ?? {}) };
  for (const key of Object.keys(applied) as (keyof Location["attributes"])[]) {
    locKnowledge[key] = {
      observedAtHours: nowHours,
      value: attrs[key],
      quality: "high",
    };
  }
  const nextKnowledge: PlayerKnowledge = {
    byLocation: {
      ...byLocation,
      [locationId]: locKnowledge,
    },
  };

  return {
    nextLocations,
    nextKnowledge,
    appliedLocationAttributes: applied,
    locationAttributeChanges: changes,
  };
}

const getTruthValueByKey = (truth: LocationTruth, key: string): number | string[] => {
  switch (key) {
    case "garrisonStrength":
      return truth.garrisonStrength;
    case "patrolFrequency":
      return truth.patrolFrequency;
    case "customsScrutiny":
      return truth.customsScrutiny;
    case "enemyAgents":
      return truth.enemyAgents ?? [];
    case "enemyMissions":
      return truth.enemyMissions ?? [];
    case "specialHooks":
      return truth.specialHooks ?? [];
    case "resistance":
      return truth.resistance ?? 0;
    case "techLevel":
      return truth.techLevel ?? 0;
    case "populationDensity":
      return truth.populationDensity ?? 0;
    case "popularSupport":
      return truth.popularSupport ?? 0;
    case "healthcareFacilities":
      return truth.healthcareFacilities ?? 0;
    default:
      return 0;
  }
};

const isTruthKeyNumeric = (key: string): boolean =>
  key === "garrisonStrength" ||
  key === "patrolFrequency" ||
  key === "customsScrutiny" ||
  key === "resistance" ||
  key === "techLevel" ||
  key === "populationDensity" ||
  key === "popularSupport" ||
  key === "healthcareFacilities";

export const INTEL_KEY_LABEL: Record<string, string> = {
  customsScrutiny: "Customs",
  patrolFrequency: "Patrols",
  garrisonStrength: "Garrison",
  enemyAgents: "Enemy agents",
  enemyMissions: "Enemy missions",
  specialHooks: "Special hooks",
  resistance: "Resistance",
  techLevel: "Tech level",
  populationDensity: "Population",
  popularSupport: "Popular support",
  healthcareFacilities: "Healthcare",
};

export const INTEL_DISPLAY_ORDER = [
  "customsScrutiny",
  "patrolFrequency",
  "garrisonStrength",
  "resistance",
  "techLevel",
  "populationDensity",
  "popularSupport",
  "healthcareFacilities",
  "enemyAgents",
  "enemyMissions",
  "specialHooks",
];

/** Eight location intel keys used by the global gather-intel mission (random one at resolution). */
const GATHER_INTEL_KEYS: string[] = [
  "garrisonStrength",
  "patrolFrequency",
  "customsScrutiny",
  "resistance",
  "techLevel",
  "populationDensity",
  "popularSupport",
  "healthcareFacilities",
];

const applyIntelRewards = (
  state: GameState,
  locationId: string,
  keys: string[],
  quality: IntelQuality,
): { nextState: GameState; summary: string } => {
  const truth = getLocationTruth(state, locationId);
  const byLocation = state.runtime.knowledge?.byLocation ?? {};
  const locKnowledge = { ...(byLocation[locationId] ?? {}) };
  const partByKey: Record<string, string> = {};
  for (const key of keys) {
    const value = getTruthValueByKey(truth, key);
    const snapshot: IntelSnapshot = {
      observedAtHours: state.runtime.nowHours,
      value,
      quality,
    };
    locKnowledge[key] = snapshot;
    const label = INTEL_KEY_LABEL[key] ?? key;
    if (isTruthKeyNumeric(key)) {
      partByKey[key] = `${label} ${value as number}`;
    } else {
      const arr = value as string[];
      if (arr.length > 0) {
        partByKey[key] = `${label}: ${arr.join(", ")}`;
      }
    }
  }
  const orderedParts = INTEL_DISPLAY_ORDER.filter((k) => partByKey[k]).map(
    (k) => partByKey[k],
  );
  const summary =
    orderedParts.length > 0 ? `Recon: ${orderedParts.join(" · ")}` : "Recon: no data";
  const nextKnowledge = {
    byLocation: {
      ...byLocation,
      [locationId]: locKnowledge,
    },
  };
  const nextState: GameState = {
    ...state,
    runtime: {
      ...state.runtime,
      knowledge: nextKnowledge,
    },
  };
  return { nextState, summary };
};

const isPlanInTimeWindow = (state: GameState, plan: MissionPlan) => {
  if (!plan.availability || plan.availability.type !== "time") {
    return true;
  }
  return (
    state.runtime.nowHours >= plan.availability.startHours &&
    state.runtime.nowHours <= plan.availability.endHours
  );
};

const getActiveOffer = (
  state: GameState,
  planId: string,
  locationId: string,
) =>
  state.runtime.missionOffers.find(
    (offer) =>
      offer.planId === planId &&
      offer.locationId === locationId &&
      offer.expiresAtHours > state.runtime.nowHours,
  );

export const validateAssignment = (
  state: GameState,
  plan: MissionPlan,
  personnel: Personnel[],
  locationId?: string,
): string[] => {
  const errors: string[] = [];
  if (personnel.length === 0) {
    errors.push("No personnel selected");
    return errors;
  }
  if (locationId && isLocationDisabled(state, locationId)) {
    errors.push("That location is not available for missions.");
    return errors;
  }

  if (plan.type === "recovery") {
    if (personnel.length !== 1) {
      errors.push("Recovery requires exactly one agent.");
      return errors;
    }
    if (personnel[0].status !== "wounded") {
      errors.push("Only wounded agents can be assigned to Recovery.");
      return errors;
    }
    const targetLocationId = locationId ?? personnel[0].locationId;
    if (!targetLocationId || targetLocationId === "galaxy") {
      errors.push("Select a location where the agent will receive care.");
      return errors;
    }
    const location = getLocation(state, targetLocationId);
    if (!location) {
      errors.push("Recovery location not found.");
      return errors;
    }
    return errors;
  }

  if (plan.type === "rescue") {
    if (!locationId || locationId === "galaxy") {
      errors.push("Select a location where an agent is captured.");
      return errors;
    }
    const capturedAtLocation = state.runtime.personnel.filter(
      (p) => p.status === "captured" && p.capturedLocationId === locationId,
    );
    if (capturedAtLocation.length === 0) {
      errors.push("No captured agents at this location.");
      return errors;
    }
  }

  if (plan.type === "search") {
    if (!locationId || locationId === "galaxy") {
      errors.push("Select a location to search for the MIA agent.");
      return errors;
    }
    const miaAtLocation = state.runtime.personnel.filter(
      (p) => p.status === "mia" && p.miaLocationId === locationId,
    );
    if (miaAtLocation.length === 0) {
      errors.push("No MIA agents linked to this location.");
      return errors;
    }
  }

  if (plan.id === "gather-intel") {
    if (!locationId || locationId === "galaxy") {
      errors.push("Select a location to gather intel on.");
      return errors;
    }
  }

  const isGlobal = plan.availability?.type === "global";
  const targetLocationId = locationId ?? personnel[0].locationId;
  if (!isGlobal) {
    const targetLocation = getLocation(state, targetLocationId);
    if (!targetLocation) {
      errors.push("Assignment target location not found.");
      return errors;
    }
    const targetPlanetId = targetLocation.planetId;
    for (const person of personnel) {
      if (person.status !== "idle") {
        errors.push(`${person.name} is not idle`);
      }
      const personLocation = getLocation(state, person.locationId);
      if (!personLocation || personLocation.planetId !== targetPlanetId) {
        const planetName =
          state.data.planets.find((planet) => planet.id === targetPlanetId)?.name ??
          targetPlanetId;
        errors.push(`${person.name} is not on ${planetName}`);
      }
    }
  } else {
    for (const person of personnel) {
      if (person.status !== "idle") {
        errors.push(`${person.name} is not idle`);
      }
    }
  }

  if (plan.requiredRoles.length > 0) {
    const required = new Set<PersonnelRole>(plan.requiredRoles);
    const hasMatch = personnel.some((person) =>
      person.roles.some((role) => required.has(role)),
    );
    if (!hasMatch) {
      errors.push(`Missing roles: ${plan.requiredRoles.join(", ")}`);
    }
  }
  if (plan.type === "training" && plan.trainingReward) {
    const rewardRoleId = plan.trainingReward.roleId;
    for (const person of personnel) {
      if (
        person.roles.length >= MAX_PERSONNEL_ROLES &&
        !person.roles.includes(rewardRoleId)
      ) {
        errors.push(
          `Maximum roles reached; ${person.name} cannot train for another role.`,
        );
      }
    }
  }
  if (!isPlanInTimeWindow(state, plan)) {
    errors.push("Assignment is not available at this time.");
  }
  if (!plan.availability || plan.availability.type !== "global") {
    const offer = getActiveOffer(state, plan.id, targetLocationId);
    if (!offer) {
      errors.push("Assignment is not currently available at this location.");
    }
  }
  errors.push(...hasMaterials(state, plan.requiredMaterials));
  errors.push(...hasCredits(state, plan));
  return errors;
};

/** True if this person can be assigned to this plan. For training plans with a reward role: false when at max roles and person does not already have the reward role. */
export const canPersonnelBeAssignedToTrainingPlan = (
  person: Personnel,
  plan: MissionPlan,
): boolean => {
  if (plan.type !== "training" || !plan.trainingReward) return true;
  const rewardRoleId = plan.trainingReward.roleId;
  if (person.roles.includes(rewardRoleId)) return true;
  return person.roles.length < MAX_PERSONNEL_ROLES;
};

export const assignPersonnelToMission = (
  state: GameState,
  planId: string,
  personnelIds: string[],
  locationId?: string,
): GameState => {
  const plan = getMissionPlan(state, planId);
  if (!plan) {
    throw new Error(`Mission plan ${planId} not found`);
  }

  const personnel = personnelIds
    .map((id) => getPersonnel(state, id))
    .filter((person): person is Personnel => Boolean(person));
  if (personnel.length !== personnelIds.length) {
    throw new Error("One or more personnel not found");
  }

  const targetLocationId =
    plan.type === "recovery" ||
    plan.type === "rescue" ||
    plan.type === "search" ||
    plan.id === "gather-intel"
      ? (locationId ?? personnel[0].locationId)
      : plan.availability?.type === "global"
        ? "galaxy"
        : locationId ?? personnel[0].locationId;
  const errors = validateAssignment(state, plan, personnel, targetLocationId);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const remainingHours =
    plan.type === "recovery"
      ? getRecoveryDurationHours(state, targetLocationId)
      : plan.type === "training"
        ? (() => {
            const minMult = (balance as { trainingDurationMultiplierMin?: number }).trainingDurationMultiplierMin ?? 4;
            const maxMult = (balance as { trainingDurationMultiplierMax?: number }).trainingDurationMultiplierMax ?? 8;
            const multiplier = minMult + Math.random() * (maxMult - minMult);
            return Math.round(plan.durationHours * multiplier);
          })()
        : plan.durationHours;
  const targetPersonnelIds =
    plan.type === "rescue"
      ? state.runtime.personnel
          .filter(
            (p) =>
              p.status === "captured" && p.capturedLocationId === targetLocationId,
          )
          .map((p) => p.id)
      : plan.type === "search"
        ? state.runtime.personnel
            .filter(
              (p) => p.status === "mia" && p.miaLocationId === targetLocationId,
            )
            .map((p) => p.id)
        : undefined;
  const mission: MissionInstance = {
    id: `mission-${Date.now()}`,
    planId: plan.id,
    locationId: targetLocationId,
    assignedPersonnelIds: personnelIds,
    ...(targetPersonnelIds?.length ? { targetPersonnelIds } : {}),
    status: "active",
    remainingHours,
    startedAtHours: state.runtime.nowHours,
  };

  const offerToConsume =
    plan.type === "recovery" || plan.availability?.type === "global"
      ? null
      : getActiveOffer(state, plan.id, targetLocationId);

  return {
    ...state,
    runtime: {
      ...state.runtime,
      resources: {
        ...state.runtime.resources,
        credits: state.runtime.resources.credits - (plan.creditsCost ?? 0),
      },
      personnel: state.runtime.personnel.map((person) =>
        personnelIds.includes(person.id)
          ? {
              ...person,
              status: "assigned",
            }
          : person,
      ),
      materials: consumeMaterials(
        state.runtime.materials,
        plan.requiredMaterials,
        getMissionConsumeModifier(personnel).total,
      ),
      missions: [...state.runtime.missions, mission],
      missionOffers: offerToConsume
        ? state.runtime.missionOffers.filter((offer) => offer.id !== offerToConsume.id)
        : state.runtime.missionOffers,
    },
  };
};

/** Compute travel duration in hours based on the geographic relationship between locations. */
export const getTravelDuration = (
  fromLocationId: string,
  toLocationId: string,
  state: GameState,
): number => {
  const bal = balance as unknown as Record<string, number>;
  const samePlanet = bal.travelSamePlanetHours ?? 12;
  const sameSector = bal.travelSameSectorHours ?? 48;
  const interSector = bal.travelInterSectorHours ?? 120;

  if (fromLocationId === toLocationId) return 1;

  const fromLoc = state.data.locations.find((l) => l.id === fromLocationId);
  const toLoc = state.data.locations.find((l) => l.id === toLocationId);
  if (!fromLoc || !toLoc) return sameSector;

  if (fromLoc.planetId === toLoc.planetId) return samePlanet;

  const fromPlanet = state.data.planets.find((p) => p.id === fromLoc.planetId);
  const toPlanet = state.data.planets.find((p) => p.id === toLoc.planetId);
  if (fromPlanet && toPlanet && fromPlanet.sectorId === toPlanet.sectorId) return sameSector;

  return interSector;
};

export const assignTravel = (
  state: GameState,
  personnelId: string,
  toLocationId: string,
  travelHours: number,
): GameState => {
  if (travelHours <= 0) {
    throw new Error("Travel time must be greater than 0.");
  }
  const person = getPersonnel(state, personnelId);
  if (!person) {
    throw new Error(`Personnel ${personnelId} not found`);
  }
  if (person.status !== "idle") {
    throw new Error(`${person.name} is not idle`);
  }
  if (person.locationId === toLocationId) {
    throw new Error(`${person.name} is already at ${toLocationId}`);
  }
  if (isLocationDisabled(state, toLocationId)) {
    throw new Error("That location is not available for travel.");
  }

  const travel: TravelAssignment = {
    id: `travel-${Date.now()}`,
    personnelId,
    fromLocationId: person.locationId,
    toLocationId,
    remainingHours: travelHours,
    startedAtHours: state.runtime.nowHours,
  };

  const event: TravelEvent = {
    id: `event-${Date.now()}`,
    kind: "travel",
    personnelId,
    fromLocationId: person.locationId,
    toLocationId,
    status: "started",
    atHours: state.runtime.nowHours,
    travelHours,
  };

  return {
    ...state,
    runtime: {
      ...state.runtime,
      personnel: state.runtime.personnel.map((item) =>
        item.id === personnelId ? { ...item, status: "traveling" } : item,
      ),
      travel: [...state.runtime.travel, travel],
      eventLog: [...state.runtime.eventLog, event],
    },
  };
};

type AdverseOutcome = "wounded" | "captured" | "mia" | "killed";

/** Returns the adverse outcome for one agent based on effective risk and mission success. */
export function rollAdverseOutcome(
  effectiveRisk: number,
  missionSuccess: boolean,
  rng: () => number = Math.random,
): "safe" | AdverseOutcome {
  const adverseScale = 0.85;
  let totalAdverse = effectiveRisk * adverseScale;
  if (!missionSuccess) {
    const shift = (balance as { failureOutcomeShift?: number }).failureOutcomeShift ?? 0.25;
    totalAdverse = Math.min(1, totalAdverse + shift);
  }
  const roll = rng();
  if (roll < 1 - totalAdverse) return "safe";

  const injuryF = (balance as { riskInjuryFactor?: number }).riskInjuryFactor ?? 0.25;
  const captureF = (balance as { riskCaptureFactor?: number }).riskCaptureFactor ?? 0.08;
  const miaF = (balance as { riskMiaFactor?: number }).riskMiaFactor ?? 0.04;
  const killedF = (balance as { riskKilledFactor?: number }).riskKilledFactor ?? 0.02;
  const killedThreshold = (balance as { riskKilledThreshold?: number }).riskKilledThreshold ?? 0.7;

  const adverseRoll = (roll - (1 - totalAdverse)) / totalAdverse;
  const sumF = injuryF + captureF + miaF + killedF;
  const injuryEnd = injuryF / sumF;
  const captureEnd = injuryEnd + captureF / sumF;
  const miaEnd = captureEnd + miaF / sumF;

  if (adverseRoll < injuryEnd) return "wounded";
  if (adverseRoll < captureEnd) return "captured";
  if (adverseRoll < miaEnd) return "mia";
  if (effectiveRisk >= killedThreshold) return "killed";
  return "mia";
}

const resolveMission = (
  state: GameState,
  mission: MissionInstance,
): GameState => {
  const plan = getMissionPlan(state, mission.planId);
  if (!plan) {
    return state;
  }

  if (plan.type === "recovery") {
    const updatedPersonnel = state.runtime.personnel.map((person) =>
      mission.assignedPersonnelIds.includes(person.id)
        ? { ...person, status: "idle" as const }
        : person,
    );
    const updatedMission: MissionInstance = {
      ...mission,
      status: "resolved",
      remainingHours: 0,
    };
    const event: MissionEvent = {
      id: `event-${Date.now()}`,
      kind: "mission",
      missionId: mission.id,
      planId: mission.planId,
      status: "resolved",
      resolvedAtHours: state.runtime.nowHours,
      success: true,
      personnelIds: [...mission.assignedPersonnelIds],
      rewardsApplied: {},
      locationId: mission.locationId,
    };
    return {
      ...state,
      runtime: {
        ...state.runtime,
        personnel: updatedPersonnel,
        missions: state.runtime.missions.map((item) =>
          item.id === mission.id ? updatedMission : item,
        ),
        eventLog: [...state.runtime.eventLog, event],
      },
    };
  }

  if (plan.type === "rescue") {
    const nowHours = state.runtime.nowHours;
    const targetIds = mission.targetPersonnelIds?.length
      ? mission.targetPersonnelIds
      : state.runtime.personnel
          .filter(
            (p) =>
              p.status === "captured" && p.capturedLocationId === mission.locationId,
          )
          .map((p) => p.id);
    const assignedPersonnel = state.runtime.personnel.filter((p) =>
      mission.assignedPersonnelIds.includes(p.id),
    );
    const { chance: rawSuccessChance } = getMissionSuccessChance(plan, assignedPersonnel);
    const counterOpPenalty = mission.enemyCounterOp
      ? ((balance as unknown as Record<string, number>).enemyCounterOpPenalty ?? 0.2)
      : 0;
    const successChance = Math.max(0, rawSuccessChance - counterOpPenalty);
    const success = Math.random() <= successChance;

    const rewardBundle = success ? plan.rewards : plan.penalties;
    const rewardDirection: 1 | -1 = success ? 1 : -1;
    const rewardMultiplier = success ? getMissionRewardModifier(assignedPersonnel).total : 0;
    const rewardResult = applyRewardBundle(state, rewardBundle, rewardMultiplier, rewardDirection);

    const restingMinHours = (balance as { restingMinHours?: number }).restingMinHours ?? 2;
    const successFactor = (balance as { restingAfterSuccessFactor?: number }).restingAfterSuccessFactor ?? 0.25;
    const failureFactor = (balance as { restingAfterFailureFactor?: number }).restingAfterFailureFactor ?? 0.75;

    // Apply adverse outcomes to rescuers
    let updatedPersonnel = state.runtime.personnel.map((person) => {
      if (!mission.assignedPersonnelIds.includes(person.id)) return person;
      const effectiveRisk = getMissionOperationalRisk(state, plan, mission.locationId, [person]);
      const outcome = rollAdverseOutcome(effectiveRisk, success);
      const restHours = outcome === "safe"
        ? Math.max(restingMinHours, plan.durationHours * (success ? successFactor : failureFactor))
        : 0;
      if (outcome === "safe") return { ...person, status: "resting" as const, restingUntilHours: nowHours + restHours };
      if (outcome === "wounded") return { ...person, status: "wounded" as const, woundedAtHours: nowHours };
      if (outcome === "captured") return { ...person, status: "captured" as const, capturedAtHours: nowHours, capturedLocationId: mission.locationId };
      if (outcome === "mia") return { ...person, status: "mia" as const, miaAtHours: nowHours, miaLocationId: mission.locationId };
      return { ...person, status: "killed" as const, killedAtHours: nowHours, killedMissionId: mission.id };
    });

    // Apply outcomes to captured targets
    const rescuedPersonnelIds: string[] = [];
    const targetAdverseOutcomes: NonNullable<MissionEvent["targetAdverseOutcomes"]> = [];

    if (success) {
      for (const personnelId of targetIds) {
        const person = updatedPersonnel.find((p) => p.id === personnelId);
        if (!person || person.status !== "captured") continue;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { capturedAtHours: _ca, capturedLocationId: _cl, ...rest } = person;
        updatedPersonnel = updatedPersonnel.map((p) =>
          p.id !== personnelId ? p : { ...rest, status: "idle" as const },
        );
        rescuedPersonnelIds.push(personnelId);
      }
    } else {
      // Determine what happens to targets when the rescue fails
      const locationRisk = getMissionOperationalRisk(state, plan, mission.locationId, []);
      const availableLocations = state.data.locations.filter(
        (loc) =>
          !loc.disabled &&
          loc.id !== mission.locationId &&
          !state.runtime.personnel.some(
            (p) => p.locationId === loc.id && !["captured", "mia", "killed"].includes(p.status),
          ),
      );
      for (const personnelId of targetIds) {
        const person = updatedPersonnel.find((p) => p.id === personnelId);
        if (!person || person.status !== "captured") continue;
        const executeThreshold = locationRisk >= 0.7 ? 0.15 : locationRisk >= 0.4 ? 0.05 : -1;
        if (executeThreshold >= 0 && Math.random() < executeThreshold) {
          updatedPersonnel = updatedPersonnel.map((p) =>
            p.id !== personnelId
              ? p
              : { ...p, status: "killed" as const, killedAtHours: nowHours, killedMissionId: mission.id, capturedAtHours: undefined, capturedLocationId: undefined },
          );
          targetAdverseOutcomes.push({ personnelId, outcome: "executed" });
        } else if (locationRisk >= 0.4 && availableLocations.length > 0) {
          const newLoc = availableLocations[Math.floor(Math.random() * availableLocations.length)];
          updatedPersonnel = updatedPersonnel.map((p) =>
            p.id !== personnelId ? p : { ...p, capturedLocationId: newLoc.id },
          );
          targetAdverseOutcomes.push({ personnelId, outcome: "moved", newLocationId: newLoc.id });
        }
        // locationRisk < 0.4: target stays put, no adverse outcome recorded
      }
    }

    // Role and trait gains for rescuers on success
    let personnelAfterRoleGains = updatedPersonnel;
    let roleGained: Array<{ personnelId: string; roleId: string; newLevel?: number }> = [];
    if (success) {
      const maxRoleLevel = (balance as { maxRoleLevel?: number }).maxRoleLevel;
      const postLevelChance = (balance as { postMissionLevelChance?: number }).postMissionLevelChance ?? 0.03;
      const result = applyPostMissionLevelGain(personnelAfterRoleGains, mission.assignedPersonnelIds, maxRoleLevel, postLevelChance);
      personnelAfterRoleGains = result.personnel;
      roleGained = result.roleGained;
    }

    const traitGained: Array<{ personnelId: string; traitId: string }> = [];
    const successCandidates = ["battle-tested", "confident", "lucky"];
    const failureCandidates = ["shaken", "overcautious", "reckless"].filter((t) => MUTABLE_POOL.includes(t));
    const woundedCandidates = ["scarred", "trauma"].filter((t) => MUTABLE_POOL.includes(t));
    let personnelAfterTraitGains = personnelAfterRoleGains;
    for (const personnelId of mission.assignedPersonnelIds) {
      personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
        p.id !== personnelId
          ? p
          : tryAddMutableTrait(p, success ? successCandidates : failureCandidates),
      );
      const person = personnelAfterTraitGains.find((p) => p.id === personnelId);
      if (person?.status === "wounded") {
        personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
          p.id !== personnelId ? p : tryAddMutableTrait(p, woundedCandidates),
        );
      }
    }
    for (const personnelId of mission.assignedPersonnelIds) {
      const before = personnelAfterRoleGains.find((p) => p.id === personnelId);
      const after = personnelAfterTraitGains.find((p) => p.id === personnelId);
      if (!before || !after) continue;
      const beforeSet = new Set(before.mutableTraits ?? []);
      for (const t of after.mutableTraits ?? []) {
        if (!beforeSet.has(t)) traitGained.push({ personnelId, traitId: t });
      }
    }

    const updatedMission: MissionInstance = {
      ...mission,
      status: success ? "resolved" : "failed",
      remainingHours: 0,
    };
    const event: MissionEvent = {
      id: `event-${Date.now()}`,
      kind: "mission",
      missionId: mission.id,
      planId: mission.planId,
      status: updatedMission.status,
      resolvedAtHours: nowHours,
      success,
      personnelIds: [...mission.assignedPersonnelIds],
      rewardsApplied: rewardResult.applied,
      locationId: mission.locationId,
      ...(roleGained.length > 0 && { roleGained }),
      ...(traitGained.length > 0 && { traitGained }),
      ...(rescuedPersonnelIds.length > 0 && { rescuedPersonnelIds }),
      ...(targetAdverseOutcomes.length > 0 && { targetAdverseOutcomes }),
    };
    return {
      ...state,
      runtime: {
        ...state.runtime,
        resources: rewardResult.resources,
        materials: rewardResult.materials,
        personnel: personnelAfterTraitGains,
        missions: state.runtime.missions.map((item) =>
          item.id === mission.id ? updatedMission : item,
        ),
        eventLog: [...state.runtime.eventLog, event],
      },
    };
  }

  if (plan.type === "search") {
    const nowHours = state.runtime.nowHours;
    const targetIds = mission.targetPersonnelIds?.length
      ? mission.targetPersonnelIds
      : state.runtime.personnel
          .filter(
            (p) => p.status === "mia" && p.miaLocationId === mission.locationId,
          )
          .map((p) => p.id);
    const assignedPersonnel = state.runtime.personnel.filter((p) =>
      mission.assignedPersonnelIds.includes(p.id),
    );
    const { chance: rawSuccessChance } = getMissionSuccessChance(plan, assignedPersonnel);
    const counterOpPenalty = mission.enemyCounterOp
      ? ((balance as unknown as Record<string, number>).enemyCounterOpPenalty ?? 0.2)
      : 0;
    const successChance = Math.max(0, rawSuccessChance - counterOpPenalty);
    const roll = Math.random();
    const success = roll <= successChance;

    const rewardBundle = success ? plan.rewards : plan.penalties;
    const rewardDirection: 1 | -1 = success ? 1 : -1;
    const rewardMultiplier = success ? getMissionRewardModifier(assignedPersonnel).total : 0;
    const rewardResult = applyRewardBundle(state, rewardBundle, rewardMultiplier, rewardDirection);

    const restingMinHours = (balance as { restingMinHours?: number }).restingMinHours ?? 2;
    const successFactor = (balance as { restingAfterSuccessFactor?: number }).restingAfterSuccessFactor ?? 0.25;
    const failureFactor = (balance as { restingAfterFailureFactor?: number }).restingAfterFailureFactor ?? 0.75;

    const outcomeRoll = Math.random();
    let searchOutcome: "found" | "intel_captured" | "failed" = "failed";
    if (success) {
      if (outcomeRoll < 0.6) searchOutcome = "found";
      else if (outcomeRoll < 0.85) searchOutcome = "intel_captured";
    }

    // Resolve MIA target outcomes
    const rescuedPersonnelIds: string[] = [];
    let updatedPersonnel = state.runtime.personnel;
    const locationRisk = getMissionOperationalRisk(state, plan, mission.locationId, []);

    for (const personnelId of targetIds) {
      const person = updatedPersonnel.find((p) => p.id === personnelId);
      if (!person || person.status !== "mia") continue;
      if (searchOutcome === "found") {
        // High-risk location: small chance agent was found too late
        if (locationRisk >= 0.7 && Math.random() < 0.05) {
          updatedPersonnel = updatedPersonnel.map((p) =>
            p.id !== personnelId
              ? p
              : { ...p, status: "killed" as const, killedAtHours: nowHours, killedMissionId: mission.id, miaAtHours: undefined, miaLocationId: undefined },
          );
        } else {
          const wounded = Math.random() < 0.2;
          updatedPersonnel = updatedPersonnel.map((p) =>
            p.id !== personnelId
              ? p
              : wounded
                ? { ...p, status: "wounded" as const, woundedAtHours: nowHours, miaAtHours: undefined, miaLocationId: undefined }
                : { ...p, status: "idle" as const, miaAtHours: undefined, miaLocationId: undefined },
          );
          rescuedPersonnelIds.push(personnelId);
        }
      } else if (searchOutcome === "intel_captured") {
        updatedPersonnel = updatedPersonnel.map((p) =>
          p.id !== personnelId
            ? p
            : { ...p, status: "captured" as const, capturedAtHours: nowHours, capturedLocationId: mission.locationId, miaAtHours: undefined, miaLocationId: undefined },
        );
      }
    }

    // Apply adverse outcomes to searchers
    updatedPersonnel = updatedPersonnel.map((person) => {
      if (!mission.assignedPersonnelIds.includes(person.id)) return person;
      const effectiveRisk = getMissionOperationalRisk(state, plan, mission.locationId, [person]);
      const outcome = rollAdverseOutcome(effectiveRisk, success);
      const restHours = outcome === "safe"
        ? Math.max(restingMinHours, plan.durationHours * (success ? successFactor : failureFactor))
        : 0;
      if (outcome === "safe") return { ...person, status: "resting" as const, restingUntilHours: nowHours + restHours };
      if (outcome === "wounded") return { ...person, status: "wounded" as const, woundedAtHours: nowHours };
      if (outcome === "captured") return { ...person, status: "captured" as const, capturedAtHours: nowHours, capturedLocationId: mission.locationId };
      if (outcome === "mia") return { ...person, status: "mia" as const, miaAtHours: nowHours, miaLocationId: mission.locationId };
      return { ...person, status: "killed" as const, killedAtHours: nowHours, killedMissionId: mission.id };
    });

    // Role and trait gains for searchers on success
    let personnelAfterRoleGains = updatedPersonnel;
    let roleGained: Array<{ personnelId: string; roleId: string; newLevel?: number }> = [];
    if (success) {
      const maxRoleLevel = (balance as { maxRoleLevel?: number }).maxRoleLevel;
      const postLevelChance = (balance as { postMissionLevelChance?: number }).postMissionLevelChance ?? 0.03;
      const result = applyPostMissionLevelGain(personnelAfterRoleGains, mission.assignedPersonnelIds, maxRoleLevel, postLevelChance);
      personnelAfterRoleGains = result.personnel;
      roleGained = result.roleGained;
    }

    const traitGained: Array<{ personnelId: string; traitId: string }> = [];
    const successCandidates = ["battle-tested", "confident", "lucky"];
    const failureCandidates = ["shaken", "overcautious", "reckless"].filter((t) => MUTABLE_POOL.includes(t));
    const woundedCandidates = ["scarred", "trauma"].filter((t) => MUTABLE_POOL.includes(t));
    let personnelAfterTraitGains = personnelAfterRoleGains;
    for (const personnelId of mission.assignedPersonnelIds) {
      personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
        p.id !== personnelId
          ? p
          : tryAddMutableTrait(p, success ? successCandidates : failureCandidates),
      );
      const person = personnelAfterTraitGains.find((p) => p.id === personnelId);
      if (person?.status === "wounded") {
        personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
          p.id !== personnelId ? p : tryAddMutableTrait(p, woundedCandidates),
        );
      }
    }
    for (const personnelId of mission.assignedPersonnelIds) {
      const before = personnelAfterRoleGains.find((p) => p.id === personnelId);
      const after = personnelAfterTraitGains.find((p) => p.id === personnelId);
      if (!before || !after) continue;
      const beforeSet = new Set(before.mutableTraits ?? []);
      for (const t of after.mutableTraits ?? []) {
        if (!beforeSet.has(t)) traitGained.push({ personnelId, traitId: t });
      }
    }

    const updatedMission: MissionInstance = {
      ...mission,
      status: success ? "resolved" : "failed",
      remainingHours: 0,
    };
    const event: MissionEvent = {
      id: `event-${Date.now()}`,
      kind: "mission",
      missionId: mission.id,
      planId: mission.planId,
      status: updatedMission.status,
      resolvedAtHours: nowHours,
      success,
      personnelIds: [...mission.assignedPersonnelIds],
      rewardsApplied: rewardResult.applied,
      locationId: mission.locationId,
      ...(roleGained.length > 0 && { roleGained }),
      ...(traitGained.length > 0 && { traitGained }),
      ...(rescuedPersonnelIds.length > 0 && { rescuedPersonnelIds }),
    };
    return {
      ...state,
      runtime: {
        ...state.runtime,
        resources: rewardResult.resources,
        materials: rewardResult.materials,
        personnel: personnelAfterTraitGains,
        missions: state.runtime.missions.map((item) =>
          item.id === mission.id ? updatedMission : item,
        ),
        eventLog: [...state.runtime.eventLog, event],
      },
    };
  }

  const assignedPersonnel = state.runtime.personnel.filter((person) =>
    mission.assignedPersonnelIds.includes(person.id),
  );
  const { chance: rawSuccessChance } = getMissionSuccessChance(plan, assignedPersonnel);
  const counterOpPenalty = mission.enemyCounterOp
    ? ((balance as unknown as Record<string, number>).enemyCounterOpPenalty ?? 0.2)
    : 0;
  const successChance = Math.max(0, rawSuccessChance - counterOpPenalty);
  const rewardModifier = getMissionRewardModifier(assignedPersonnel);
  const roll = Math.random();
  const success = roll <= successChance;

  const rewardBundle = success ? plan.rewards : plan.penalties;
  const rewardDirection: 1 | -1 = success ? 1 : -1;
  const rewardMultiplier = success ? rewardModifier.total : 0;
  const rewardResult = applyRewardBundle(
    state,
    rewardBundle,
    rewardMultiplier,
    rewardDirection,
  );

  const nowHours = state.runtime.nowHours;
  const restingMinHours = (balance as { restingMinHours?: number }).restingMinHours ?? 2;
  const successFactor = (balance as { restingAfterSuccessFactor?: number }).restingAfterSuccessFactor ?? 0.25;
  const failureFactor = (balance as { restingAfterFailureFactor?: number }).restingAfterFailureFactor ?? 0.75;

  const updatedPersonnel = state.runtime.personnel.map((person) => {
    if (!mission.assignedPersonnelIds.includes(person.id)) {
      return person;
    }
    const effectiveRisk = getMissionOperationalRisk(state, plan, mission.locationId, [person]);
    const outcome = rollAdverseOutcome(effectiveRisk, success);
    const restHours =
      outcome === "safe"
        ? Math.max(
            restingMinHours,
            plan.durationHours * (success ? successFactor : failureFactor),
          )
        : 0;

    if (outcome === "safe") {
      return {
        ...person,
        status: "resting" as const,
        restingUntilHours: nowHours + restHours,
      };
    }
    if (outcome === "wounded") {
      return {
        ...person,
        status: "wounded" as const,
        woundedAtHours: nowHours,
      };
    }
    if (outcome === "captured") {
      return {
        ...person,
        status: "captured" as const,
        capturedAtHours: nowHours,
        capturedLocationId: mission.locationId,
      };
    }
    if (outcome === "mia") {
      return {
        ...person,
        status: "mia" as const,
        miaAtHours: nowHours,
        miaLocationId: mission.locationId,
      };
    }
    return {
      ...person,
      status: "killed" as const,
      killedAtHours: nowHours,
      killedMissionId: mission.id,
    };
  });

  const updatedMission: MissionInstance = {
    ...mission,
    status: success ? "resolved" : "failed",
    remainingHours: 0,
  };

  // Apply morale changes for mission outcome
  const moraleBal = balance as unknown as Record<string, number>;
  const moraleDelta = success
    ? (moraleBal.moraleMissionSuccess ?? 5)
    : (moraleBal.moraleMissionFailure ?? -10);
  const personnelWithMorale = updatedPersonnel.map((person) =>
    mission.assignedPersonnelIds.includes(person.id)
      ? applyMoraleChange(person, moraleDelta)
      : person,
  );

  let intelReport: { summary: string; keys: string[] } | undefined;
  let appliedLocationAttributes: Partial<Record<keyof Location["attributes"], number>> | undefined;
  let locationAttributeChanges: Partial<Record<keyof Location["attributes"], { before: number; after: number }>> | undefined;
  let stateAfterRewards: GameState = {
    ...state,
    runtime: {
      ...state.runtime,
      resources: rewardResult.resources,
      materials: rewardResult.materials,
      personnel: personnelWithMorale,
      missions: state.runtime.missions.map((item) =>
        item.id === mission.id ? updatedMission : item,
      ),
    },
  };
  if (
    mission.locationId !== "galaxy" &&
    rewardBundle?.locationAttributes &&
    Object.keys(rewardBundle.locationAttributes).length > 0
  ) {
    const locResult = applyLocationAttributeDeltas(
      state,
      mission.locationId,
      rewardBundle.locationAttributes,
      nowHours,
    );
    if (locResult) {
      appliedLocationAttributes = locResult.appliedLocationAttributes;
      locationAttributeChanges = locResult.locationAttributeChanges;
      stateAfterRewards = {
        ...stateAfterRewards,
        data: { ...stateAfterRewards.data, locations: locResult.nextLocations },
        runtime: {
          ...stateAfterRewards.runtime,
          knowledge: locResult.nextKnowledge,
        },
      };
    }
  }
  if (
    success &&
    plan.intelRewards &&
    plan.intelRewards.target === "location" &&
    mission.locationId !== "galaxy"
  ) {
    const keysToApply =
      plan.id === "gather-intel" || (plan.intelRewards.keys && plan.intelRewards.keys.length === 0)
        ? [GATHER_INTEL_KEYS[Math.floor(Math.random() * GATHER_INTEL_KEYS.length)]]
        : plan.intelRewards.keys;
    if (keysToApply.length > 0) {
      const { nextState: withIntel, summary } = applyIntelRewards(
        stateAfterRewards,
        mission.locationId,
        keysToApply,
        plan.intelRewards.quality,
      );
      stateAfterRewards = withIntel;
      intelReport = { summary, keys: keysToApply };
    }
  }

  const roleGained: Array<{ personnelId: string; roleId: string; newLevel?: number }> = [];
  let personnelAfterRoleGains = stateAfterRewards.runtime.personnel;
  let trainingAttemptsWithoutGain: Record<string, Record<string, number>> = {
    ...(state.runtime.trainingAttemptsWithoutGain ?? {}),
  };

  if (success) {
    const maxRoleLevel = (balance as { maxRoleLevel?: number }).maxRoleLevel;
    const postLevelChance = (balance as { postMissionLevelChance?: number }).postMissionLevelChance ?? 0.03;
    const levelResult = applyPostMissionLevelGain(personnelAfterRoleGains, mission.assignedPersonnelIds, maxRoleLevel, postLevelChance);
    personnelAfterRoleGains = levelResult.personnel;
    roleGained.push(...levelResult.roleGained);

    const postChance = (balance as { postMissionRoleChance?: number }).postMissionRoleChance ?? 0.02;
    for (const personnelId of mission.assignedPersonnelIds) {
      const person = personnelAfterRoleGains.find((p) => p.id === personnelId);
      if (!person) continue;
      const candidates = (plan.requiredRoles as PersonnelRole[]).filter(
        (r) => !person.roles.includes(r),
      );
      if (candidates.length === 0) continue;
      if (Math.random() >= postChance) continue;
      const roleId = candidates[Math.floor(Math.random() * candidates.length)] as PersonnelRole;
      personnelAfterRoleGains = personnelAfterRoleGains.map((p) =>
        p.id !== personnelId
          ? p
          : {
              ...p,
              roles: [...p.roles, roleId],
              roleLevels: { ...p.roleLevels, [roleId]: 1 },
            },
      );
      roleGained.push({ personnelId, roleId });
    }

    if (plan.type === "training" && plan.trainingReward) {
      const roleId = plan.trainingReward.roleId as PersonnelRole;
      const baseChance = (balance as { trainingBaseRoleChance?: number }).trainingBaseRoleChance ?? 0.12;
      const increment = (balance as { trainingRoleChanceIncrementPerAttempt?: number }).trainingRoleChanceIncrementPerAttempt ?? 0.08;
      const maxRoleLevel = (balance as { maxRoleLevel?: number }).maxRoleLevel;

      for (const personnelId of mission.assignedPersonnelIds) {
        const person = personnelAfterRoleGains.find((p) => p.id === personnelId);
        if (!person) continue;

        const attempts =
          trainingAttemptsWithoutGain[personnelId]?.[plan.id] ?? 0;
        const chance = Math.min(
          1,
          baseChance + attempts * increment,
        );
        const roll = Math.random();

        if (person.roles.includes(roleId)) {
          const currentLevel = person.roleLevels?.[roleId] ?? 1;
          if (maxRoleLevel != null && currentLevel >= maxRoleLevel) continue;
          if (roll < chance) {
            const newLevel = currentLevel + 1;
            personnelAfterRoleGains = personnelAfterRoleGains.map((p) =>
              p.id !== personnelId
                ? p
                : { ...p, roleLevels: { ...p.roleLevels, [roleId]: newLevel } },
            );
            roleGained.push({ personnelId, roleId, newLevel });
            const next = { ...(trainingAttemptsWithoutGain[personnelId] ?? {}) };
            delete next[plan.id];
            trainingAttemptsWithoutGain = {
              ...trainingAttemptsWithoutGain,
              [personnelId]: next,
            };
          } else {
            trainingAttemptsWithoutGain = {
              ...trainingAttemptsWithoutGain,
              [personnelId]: {
                ...(trainingAttemptsWithoutGain[personnelId] ?? {}),
                [plan.id]: attempts + 1,
              },
            };
          }
        } else {
          if (person.roles.length >= MAX_PERSONNEL_ROLES) continue;
          if (roll < chance) {
            personnelAfterRoleGains = personnelAfterRoleGains.map((p) =>
              p.id !== personnelId
                ? p
                : {
                    ...p,
                    roles: [...p.roles, roleId],
                    roleLevels: { ...p.roleLevels, [roleId]: 1 },
                  },
            );
            roleGained.push({ personnelId, roleId });
            const next = { ...(trainingAttemptsWithoutGain[personnelId] ?? {}) };
            delete next[plan.id];
            trainingAttemptsWithoutGain = {
              ...trainingAttemptsWithoutGain,
              [personnelId]: next,
            };
          } else {
            trainingAttemptsWithoutGain = {
              ...trainingAttemptsWithoutGain,
              [personnelId]: {
                ...(trainingAttemptsWithoutGain[personnelId] ?? {}),
                [plan.id]: attempts + 1,
              },
            };
          }
        }
      }
    }
  }

  if (!success && plan.type === "training" && plan.trainingReward) {
    const decrement = (balance as { trainingFailurePityDecrement?: number }).trainingFailurePityDecrement ?? 1;
    for (const personnelId of mission.assignedPersonnelIds) {
      const current = trainingAttemptsWithoutGain[personnelId]?.[plan.id] ?? 0;
      const next = Math.max(0, current - decrement);
      if (next === 0) {
        const copy = { ...(trainingAttemptsWithoutGain[personnelId] ?? {}) };
        delete copy[plan.id];
        if (Object.keys(copy).length === 0) {
          const nextMap = { ...trainingAttemptsWithoutGain };
          delete nextMap[personnelId];
          trainingAttemptsWithoutGain = nextMap;
        } else {
          trainingAttemptsWithoutGain = {
            ...trainingAttemptsWithoutGain,
            [personnelId]: copy,
          };
        }
      } else {
        trainingAttemptsWithoutGain = {
          ...trainingAttemptsWithoutGain,
          [personnelId]: {
            ...(trainingAttemptsWithoutGain[personnelId] ?? {}),
            [plan.id]: next,
          },
        };
      }
    }
  }

  const successCandidatesByType: Record<string, string[]> = {
    logistics: ["pilot", "driver", "battle-tested", "confident", "lucky"],
    "gather-materials": ["driver", "battle-tested", "confident", "lucky"],
    "recruit-allies": ["connected", "confident", "lucky"],
    espionage: ["sharpened", "pickpocket", "confident", "lucky"],
    training: ["battle-tested", "confident", "sharpened", "lucky"],
  };
  const failureCandidates = (plan.type === "espionage"
    ? ["shaken", "overcautious", "burned"]
    : ["shaken", "overcautious", "reckless"]).filter((t) =>
    MUTABLE_POOL.includes(t),
  );
  const woundedCandidates = ["scarred", "trauma"].filter((t) =>
    MUTABLE_POOL.includes(t),
  );
  const successCandidates =
    successCandidatesByType[plan.type] ?? ["battle-tested", "confident", "lucky"];

  let personnelAfterTraitGains = personnelAfterRoleGains;
  if (plan.type !== "training") {
    for (const personnelId of mission.assignedPersonnelIds) {
      let person = personnelAfterTraitGains.find((p) => p.id === personnelId);
      if (!person) continue;
      if (success) {
        personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
          p.id !== personnelId ? p : tryAddMutableTrait(p, successCandidates),
        );
      } else {
        personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
          p.id !== personnelId ? p : tryAddMutableTrait(p, failureCandidates),
        );
      }
      person = personnelAfterTraitGains.find((p) => p.id === personnelId)!;
      if (person.status === "wounded") {
        personnelAfterTraitGains = personnelAfterTraitGains.map((p) =>
          p.id !== personnelId ? p : tryAddMutableTrait(p, woundedCandidates),
        );
      }
    }
  }

  const traitGained: Array<{ personnelId: string; traitId: string }> = [];
  for (const personnelId of mission.assignedPersonnelIds) {
    const before = personnelAfterRoleGains.find((p) => p.id === personnelId);
    const after = personnelAfterTraitGains.find((p) => p.id === personnelId);
    if (!before || !after) continue;
    const beforeTraits = before.mutableTraits ?? [];
    const afterTraits = after.mutableTraits ?? [];
    if (afterTraits.length > beforeTraits.length) {
      const beforeSet = new Set(beforeTraits);
      for (const t of afterTraits) {
        if (!beforeSet.has(t)) {
          traitGained.push({ personnelId, traitId: t });
        }
      }
    }
  }

  let personnelForNextState = personnelAfterTraitGains;
  const recruitedPersonnelIds: string[] = [];
  if (success && plan.type === "recruit-allies") {
    const recruitCount = balance.recruitAlliesRewardCount ?? 1;
    const stateBeforeRecruit: GameState = {
      ...stateAfterRewards,
      runtime: {
        ...stateAfterRewards.runtime,
        personnel: personnelAfterTraitGains,
        trainingAttemptsWithoutGain,
      },
    };
    const stateAfterRecruit = applyRecruitRewards(
      stateBeforeRecruit,
      mission.locationId,
      recruitCount,
    );
    personnelForNextState = stateAfterRecruit.runtime.personnel;
    recruitedPersonnelIds.push(
      ...stateAfterRecruit.runtime.personnel
        .slice(-recruitCount)
        .map((p) => p.id),
    );
  }

  const event: MissionEvent = {
    id: `event-${Date.now()}`,
    kind: "mission",
    missionId: mission.id,
    planId: mission.planId,
    status: updatedMission.status,
    resolvedAtHours: state.runtime.nowHours,
    success,
    personnelIds: [...mission.assignedPersonnelIds],
    rewardsApplied:
      appliedLocationAttributes != null && Object.keys(appliedLocationAttributes).length > 0
        ? {
            ...rewardResult.applied,
            locationAttributes: appliedLocationAttributes,
            ...(locationAttributeChanges && Object.keys(locationAttributeChanges).length > 0
              ? { locationAttributeChanges }
              : {}),
          }
        : rewardResult.applied,
    locationId: mission.locationId,
    ...(intelReport && { intelReport }),
    ...(roleGained.length > 0 && { roleGained }),
    ...(traitGained.length > 0 && { traitGained }),
    ...(recruitedPersonnelIds.length > 0 && { recruitedPersonnelIds }),
  };

  const nextState: GameState = {
    ...stateAfterRewards,
    runtime: {
      ...stateAfterRewards.runtime,
      personnel: personnelForNextState,
      trainingAttemptsWithoutGain,
      eventLog: [...state.runtime.eventLog, event],
    },
  };
  return nextState;
};

const updateMissionOffers = (state: GameState): GameState => {
  const nowHours = state.runtime.nowHours;
  const activeOffers = state.runtime.missionOffers.filter(
    (offer) => offer.expiresAtHours > nowHours,
  );
  const offersByKey = new Set(
    activeOffers.map((offer) => `${offer.planId}:${offer.locationId}`),
  );

  const newOffers: MissionOffer[] = [];
  for (const assignment of state.data.locationAssignments) {
    const plan = getMissionPlan(state, assignment.planId);
    if (!plan) {
      continue;
    }
    if (isLocationDisabled(state, assignment.locationId)) {
      continue;
    }
    if (!isPlanInTimeWindow(state, plan)) {
      continue;
    }
    const key = `${assignment.planId}:${assignment.locationId}`;
    if (offersByKey.has(key)) {
      continue;
    }
    const cooldownUntil = state.runtime.missions
      .filter(
        (mission) =>
          mission.planId === assignment.planId &&
          mission.locationId === assignment.locationId,
      )
      .reduce(
        (latest, mission) =>
          Math.max(latest, mission.startedAtHours + plan.durationHours * 2),
        0,
      );
    if (cooldownUntil > nowHours) {
      continue;
    }
    if (plan.requiresKnownHook) {
      const hookSnapshot = state.runtime.knowledge?.byLocation?.[assignment.locationId]?.specialHooks;
      const knownHooks: string[] = Array.isArray(hookSnapshot?.value) ? (hookSnapshot!.value as string[]) : [];
      if (!knownHooks.includes(plan.requiresKnownHook)) {
        continue;
      }
    }
    const roll = Math.random();
    if (roll <= assignment.appearanceChance) {
      newOffers.push({
        id: `offer-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        planId: assignment.planId,
        locationId: assignment.locationId,
        createdAtHours: nowHours,
        expiresAtHours: nowHours + assignment.windowHours,
      });
    }
  }

  if (
    newOffers.length === 0 &&
    activeOffers.length === state.runtime.missionOffers.length
  ) {
    return state;
  }

  return {
    ...state,
    runtime: {
      ...state.runtime,
      missionOffers: [...activeOffers, ...newOffers],
    },
  };
};

export const advanceTime = (state: GameState, hours: number): GameState => {
  if (hours <= 0) {
    return state;
  }

  let nextState: GameState = {
    ...state,
    runtime: { ...state.runtime, nowHours: state.runtime.nowHours + hours },
  };
  for (const mission of nextState.runtime.missions) {
    if (mission.status !== "active") {
      continue;
    }

    const remaining = mission.remainingHours - hours;
    if (remaining <= 0) {
      nextState = resolveMission(nextState, mission);
    } else {
      nextState = {
        ...nextState,
        runtime: {
          ...nextState.runtime,
          missions: nextState.runtime.missions.map((item) =>
            item.id === mission.id
              ? { ...item, remainingHours: remaining }
              : item,
          ),
        },
      };
    }
  }

  if (nextState.runtime.travel.length > 0) {
    for (const assignment of nextState.runtime.travel) {
      const remaining = assignment.remainingHours - hours;
      if (remaining <= 0) {
        const originalTravelHours = assignment.remainingHours + hours;
        const bal = balance as unknown as Record<string, number>;
        const hazardBase = bal.travelHazardBaseChance ?? 0.05;
        const destTruth = getLocationTruth(nextState, assignment.toLocationId);
        const scrutiny = destTruth.customsScrutiny ?? nextState.data.locations.find((l) => l.id === assignment.toLocationId)?.attributes.customsScrutiny ?? 0;
        const patrols = destTruth.patrolFrequency ?? nextState.data.locations.find((l) => l.id === assignment.toLocationId)?.attributes.patrolFrequency ?? 0;
        const hazardChance = hazardBase * (scrutiny + patrols) / 100;
        const hazardRoll = Math.random();
        let arrivalPersonnelStatus: "idle" | "wounded" | "captured" = "idle";
        if (hazardRoll < hazardChance) {
          arrivalPersonnelStatus = hazardRoll < hazardChance * 0.4 ? "captured" : "wounded";
        }
        const arrivalEvent: TravelEvent = {
          id: `event-${Date.now()}`,
          kind: "travel",
          personnelId: assignment.personnelId,
          fromLocationId: assignment.fromLocationId,
          toLocationId: assignment.toLocationId,
          status: "arrived",
          atHours: nextState.runtime.nowHours,
          travelHours: originalTravelHours,
          ...(arrivalPersonnelStatus !== "idle" && { hazard: arrivalPersonnelStatus }),
        };
        const arrivalPersonnel = nextState.runtime.personnel.map((person) => {
          if (person.id !== assignment.personnelId) return person;
          if (arrivalPersonnelStatus === "wounded") {
            return { ...person, locationId: assignment.toLocationId, status: "wounded" as const, woundedAtHours: nextState.runtime.nowHours };
          }
          if (arrivalPersonnelStatus === "captured") {
            return { ...person, locationId: assignment.toLocationId, status: "captured" as const, capturedAtHours: nextState.runtime.nowHours, capturedLocationId: assignment.toLocationId };
          }
          return { ...person, locationId: assignment.toLocationId, status: "idle" as const };
        });
        nextState = {
          ...nextState,
          runtime: {
            ...nextState.runtime,
            personnel: arrivalPersonnel,
            travel: nextState.runtime.travel.filter(
              (item) => item.id !== assignment.id,
            ),
            eventLog: [...nextState.runtime.eventLog, arrivalEvent],
          },
        };
      } else {
        nextState = {
          ...nextState,
          runtime: {
            ...nextState.runtime,
            travel: nextState.runtime.travel.map((item) =>
              item.id === assignment.id
                ? { ...item, remainingHours: remaining }
                : item,
            ),
          },
        };
      }
    }
  }

  const passiveHealHours = (balance as { passiveHealHours?: number }).passiveHealHours ?? 250;
  const nowHours = nextState.runtime.nowHours;
  const personnelAfterPassiveHeal = nextState.runtime.personnel.map((person) => {
    if (person.status !== "wounded") return person;
    const woundedAt = person.woundedAtHours ?? nowHours;
    if (nowHours - woundedAt >= passiveHealHours) {
      const { woundedAtHours: _, ...rest } = person;
      const healed = { ...rest, status: "idle" as const };
      const bal2 = balance as unknown as Record<string, number>;
      return applyMoraleChange(healed, bal2.moraleInjuryPenalty ?? -8);
    }
    return { ...person, woundedAtHours: woundedAt };
  });
  if (
    personnelAfterPassiveHeal.some(
      (p, i) => p !== nextState.runtime.personnel[i],
    )
  ) {
    nextState = {
      ...nextState,
      runtime: {
        ...nextState.runtime,
        personnel: personnelAfterPassiveHeal,
      },
    };
  }

  const personnelAfterRest = nextState.runtime.personnel.map((person) => {
    if (person.status !== "resting") return person;
    const until = person.restingUntilHours ?? nowHours;
    if (nowHours >= until) {
      const { restingUntilHours: _, ...rest } = person;
      return { ...rest, status: "idle" as const };
    }
    return person;
  });
  if (
    personnelAfterRest.some(
      (p, i) => p !== nextState.runtime.personnel[i],
    )
  ) {
    nextState = {
      ...nextState,
      runtime: {
        ...nextState.runtime,
        personnel: personnelAfterRest,
      },
    };
  }

  const periods24h = Math.max(1, hours / 24);
  const baseCaptureEscape = (balance as { passiveCaptureEscapeChancePer24h?: number }).passiveCaptureEscapeChancePer24h ?? 0.015;
  const escapeArtistBonus = (balance as { escapeArtistCaptureBonus?: number }).escapeArtistCaptureBonus ?? 0.02;
  const personnelAfterCaptureEscape = nextState.runtime.personnel.map((person) => {
    if (person.status !== "captured") return person;
    const chancePer24h = baseCaptureEscape + (getTraitsForPerson(person).includes("escape-artist") ? escapeArtistBonus : 0);
    const chance = 1 - Math.pow(1 - chancePer24h, periods24h);
    if (Math.random() <= chance) {
      const { capturedAtHours, capturedLocationId, ...rest } = person;
      const freed = { ...rest, status: "idle" as const, locationId: capturedLocationId ?? rest.locationId };
      const bal2 = balance as unknown as Record<string, number>;
      return applyMoraleChange(freed, bal2.moraleCapturePenalty ?? -15);
    }
    return person;
  });
  if (personnelAfterCaptureEscape.some((p, i) => p !== nextState.runtime.personnel[i])) {
    nextState = {
      ...nextState,
      runtime: { ...nextState.runtime, personnel: personnelAfterCaptureEscape },
    };
  }

  const passiveMiaReturn = (balance as { passiveMiaReturnChancePer24h?: number }).passiveMiaReturnChancePer24h ?? 0.02;
  const miaChance = 1 - Math.pow(1 - passiveMiaReturn, periods24h);
  const personnelAfterMiaReturn = nextState.runtime.personnel.map((person) => {
    if (person.status !== "mia") return person;
    if (Math.random() <= miaChance) {
      const { miaAtHours, miaLocationId, ...rest } = person;
      const returned = { ...rest, status: "idle" as const, locationId: miaLocationId ?? rest.locationId };
      const bal2 = balance as unknown as Record<string, number>;
      return applyMoraleChange(returned, bal2.moraleMiaPenalty ?? -5);
    }
    return person;
  });
  if (personnelAfterMiaReturn.some((p, i) => p !== nextState.runtime.personnel[i])) {
    nextState = {
      ...nextState,
      runtime: { ...nextState.runtime, personnel: personnelAfterMiaReturn },
    };
  }

  nextState = tickMorale(nextState);
  nextState = tickNarrativeEvents(nextState);
  nextState = tickEnemyActivity(nextState);
  return checkGamePhase(updateMissionOffers(nextState));
};

export const refreshMissionOffers = (state: GameState): GameState =>
  updateMissionOffers(state);

// ─── Enemy Activity ──────────────────────────────────────────────────────────

const setLocationTruthRuntime = (
  state: GameState,
  locationId: string,
  truth: LocationTruth,
): GameState => ({
  ...state,
  runtime: {
    ...state.runtime,
    locationTruth: { ...(state.runtime.locationTruth ?? {}), [locationId]: truth },
  },
});

type EnemyActionResult = {
  state: GameState;
  event: EnemyActionEvent | null;
};

const pickEnemyAction = (
  state: GameState,
  locationId: string,
): EnemyActionKind => {
  const hasIdleAgent = state.runtime.personnel.some(
    (p) => p.locationId === locationId && p.status === "idle",
  );
  const hasActiveMission = state.runtime.missions.some(
    (m) => m.locationId === locationId && m.status === "active",
  );

  // Build weighted pool
  const pool: EnemyActionKind[] = [];
  pool.push("patrol-increase", "patrol-increase", "patrol-increase");
  pool.push("propaganda", "propaganda", "propaganda");
  if (hasIdleAgent) pool.push("arrest", "arrest");
  else pool.push("propaganda", "propaganda"); // redistribute
  if (hasActiveMission) pool.push("counter-op", "counter-op");
  else pool.push("patrol-increase", "patrol-increase"); // redistribute

  return pool[Math.floor(Math.random() * pool.length)];
};

const applyEnemyAction = (
  state: GameState,
  location: Location,
  action: EnemyActionKind,
  now: number,
  patrolInc: number,
  supportDec: number,
): EnemyActionResult => {
  const eventId = `enemy-${location.id}-${now}`;

  if (action === "patrol-increase") {
    const updatedLocations = state.data.locations.map((l) =>
      l.id === location.id
        ? {
            ...l,
            attributes: {
              ...l.attributes,
              garrisonStrength: Math.min(100, l.attributes.garrisonStrength + patrolInc),
              patrolFrequency: Math.min(100, l.attributes.patrolFrequency + patrolInc),
            },
          }
        : l,
    );
    const event: EnemyActionEvent = {
      id: eventId,
      kind: "enemy-action",
      locationId: location.id,
      action: "patrol-increase",
      atHours: now,
    };
    return {
      state: { ...state, data: { ...state.data, locations: updatedLocations } },
      event,
    };
  }

  if (action === "propaganda") {
    const updatedLocations = state.data.locations.map((l) =>
      l.id === location.id
        ? {
            ...l,
            attributes: {
              ...l.attributes,
              popularSupport: Math.max(0, l.attributes.popularSupport - supportDec),
            },
          }
        : l,
    );
    const event: EnemyActionEvent = {
      id: eventId,
      kind: "enemy-action",
      locationId: location.id,
      action: "propaganda",
      atHours: now,
    };
    return {
      state: { ...state, data: { ...state.data, locations: updatedLocations } },
      event,
    };
  }

  if (action === "arrest") {
    const idleAgents = state.runtime.personnel.filter(
      (p) => p.locationId === location.id && p.status === "idle",
    );
    if (idleAgents.length === 0) {
      // Fallback to patrol-increase
      return applyEnemyAction(state, location, "patrol-increase", now, patrolInc, supportDec);
    }
    const target = idleAgents[Math.floor(Math.random() * idleAgents.length)];
    const updatedPersonnel = state.runtime.personnel.map((p) =>
      p.id === target.id
        ? {
            ...p,
            status: "captured" as PersonnelStatus,
            capturedAtHours: now,
            capturedLocationId: location.id,
          }
        : p,
    );
    const event: EnemyActionEvent = {
      id: eventId,
      kind: "enemy-action",
      locationId: location.id,
      action: "arrest",
      atHours: now,
      personnelId: target.id,
    };
    return {
      state: {
        ...state,
        runtime: { ...state.runtime, personnel: updatedPersonnel },
      },
      event,
    };
  }

  // counter-op
  const activeMissions = state.runtime.missions.filter(
    (m) => m.locationId === location.id && m.status === "active",
  );
  if (activeMissions.length === 0) {
    return applyEnemyAction(state, location, "propaganda", now, patrolInc, supportDec);
  }
  const target = activeMissions[Math.floor(Math.random() * activeMissions.length)];
  const updatedMissions = state.runtime.missions.map((m) =>
    m.id === target.id ? { ...m, enemyCounterOp: true } : m,
  );
  const event: EnemyActionEvent = {
    id: eventId,
    kind: "enemy-action",
    locationId: location.id,
    action: "counter-op",
    atHours: now,
    missionId: target.id,
  };
  return {
    state: {
      ...state,
      runtime: { ...state.runtime, missions: updatedMissions },
    },
    event,
  };
};

const tickMorale = (state: GameState): GameState => {
  const bal = balance as unknown as Record<string, number>;
  const interval = bal.moralePassiveTickIntervalHours ?? 24;
  const now = state.runtime.nowHours;
  const thisCheck = Math.floor(now / interval) * interval;
  const prevCheck = Math.floor((now - interval) / interval) * interval;
  if (thisCheck <= prevCheck) return state;

  const neutral = bal.moraleDefault ?? 50;
  const recovery = bal.moralePassiveRecoveryPerTick ?? 1;
  const breakingThreshold = bal.moraleBreakingPointThreshold ?? 15;
  const miaChance = bal.moraleBreakingPointMiaChance ?? 0.05;

  const personnel = state.runtime.personnel.map((person) => {
    if (person.status === "killed") return person;
    const current = getPersonnelMorale(person);
    const delta = current < neutral ? recovery : current > neutral ? -recovery : 0;
    let updated = applyMoraleChange(person, delta);
    // Breaking point: spontaneous MIA for idle/resting agents
    if (
      (updated.morale ?? neutral) <= breakingThreshold &&
      (person.status === "idle" || person.status === "resting") &&
      Math.random() < miaChance
    ) {
      updated = {
        ...updated,
        status: "mia" as const,
        miaAtHours: now,
        miaLocationId: person.locationId,
      };
    }
    return updated;
  });

  if (personnel.every((p, i) => p === state.runtime.personnel[i])) return state;
  return { ...state, runtime: { ...state.runtime, personnel } };
};

const tickNarrativeEvents = (state: GameState): GameState => {
  const bal = balance as unknown as Record<string, number>;
  const checkInterval = bal.narrativeEventCheckIntervalHours ?? 24;
  const chance = bal.narrativeEventChance ?? 0.35;
  const windowHours = bal.narrativeEventWindowHours ?? 48;
  const maxPending = bal.narrativeEventMaxPending ?? 1;
  const now = state.runtime.nowHours;
  const pending = state.runtime.narrativePending ?? [];

  // Expire old pending events
  const active = pending.filter((p) => p.expiresAtHours > now);

  if (active.length >= maxPending) {
    return { ...state, runtime: { ...state.runtime, narrativePending: active } };
  }

  // Only fire once per interval
  const thisCheck = Math.floor(now / checkInterval) * checkInterval;
  const prevCheck = Math.floor((now - checkInterval) / checkInterval) * checkInterval;
  if (thisCheck <= prevCheck) {
    return active.length !== pending.length
      ? { ...state, runtime: { ...state.runtime, narrativePending: active } }
      : state;
  }

  if (Math.random() > chance) {
    return active.length !== pending.length
      ? { ...state, runtime: { ...state.runtime, narrativePending: active } }
      : state;
  }

  const defs = (narrativeEventsData as { events: NarrativeEventDef[] }).events;
  if (defs.length === 0) return state;
  const def = defs[Math.floor(Math.random() * defs.length)];

  const activeLocs = state.data.locations.filter((l) => !l.disabled);
  const locationsWithAgents = activeLocs.filter((l) =>
    state.runtime.personnel.some(
      (p) =>
        p.locationId === l.id &&
        !["killed", "captured", "mia", "traveling"].includes(p.status),
    ),
  );
  const candidateLocs = locationsWithAgents.length > 0 ? locationsWithAgents : activeLocs;
  const locationId =
    candidateLocs.length > 0
      ? candidateLocs[Math.floor(Math.random() * candidateLocs.length)].id
      : state.runtime.headquartersId;

  const newPending: NarrativePending = {
    id: `narrative-${now}-${def.id}`,
    eventId: def.id,
    locationId,
    triggeredAtHours: now,
    expiresAtHours: now + windowHours,
  };

  return {
    ...state,
    runtime: { ...state.runtime, narrativePending: [...active, newPending] },
  };
};

export const resolveNarrativeChoice = (
  state: GameState,
  pendingId: string,
  choiceId: string,
  success = true,
): GameState => {
  const pending = state.runtime.narrativePending ?? [];
  const item = pending.find((p) => p.id === pendingId);
  if (!item) return state;

  const defs = (narrativeEventsData as { events: NarrativeEventDef[] }).events;
  const def = defs.find((d) => d.id === item.eventId);
  if (!def) return state;

  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) return state;

  const appliedOutcomes: NarrativeOutcome[] = success
    ? (choice.outcomes as NarrativeOutcome[])
    : ((choice as { failureOutcomes?: NarrativeOutcome[] }).failureOutcomes ?? []);

  let nextState = state;

  for (const outcome of appliedOutcomes) {
    if (outcome.type === "resources") {
      nextState = {
        ...nextState,
        runtime: {
          ...nextState.runtime,
          resources: {
            credits: nextState.runtime.resources.credits + (outcome.credits ?? 0),
            intel: Math.max(0, nextState.runtime.resources.intel + (outcome.intel ?? 0)),
          },
        },
      };
    } else if (outcome.type === "material") {
      const existing = nextState.runtime.materials.find((m) => m.id === outcome.materialId);
      const materials = existing
        ? nextState.runtime.materials.map((m) =>
            m.id === outcome.materialId
              ? { ...m, quantity: Math.max(0, m.quantity + outcome.quantity) }
              : m,
          )
        : outcome.quantity > 0
          ? [
              ...nextState.runtime.materials,
              { id: outcome.materialId, name: outcome.materialId, quantity: outcome.quantity },
            ]
          : nextState.runtime.materials;
      nextState = { ...nextState, runtime: { ...nextState.runtime, materials } };
    } else if (outcome.type === "location-attribute") {
      const locations = nextState.data.locations.map((l) =>
        l.id === item.locationId
          ? {
              ...l,
              attributes: {
                ...l.attributes,
                [outcome.key]: Math.max(
                  0,
                  Math.min(
                    100,
                    (l.attributes as unknown as Record<string, number>)[outcome.key] + outcome.delta,
                  ),
                ),
              },
            }
          : l,
      );
      nextState = { ...nextState, data: { ...nextState.data, locations } };
    }
  }

  const hasRisk = (choice as { successChance?: number }).successChance != null;
  const logEntry: NarrativeEventLog = {
    id: `${pendingId}-resolved`,
    kind: "narrative",
    eventId: item.eventId,
    choiceId,
    locationId: item.locationId,
    resolvedAtHours: nextState.runtime.nowHours,
    outcomes: appliedOutcomes,
    ...(hasRisk && { choiceSuccess: success }),
  };

  return {
    ...nextState,
    runtime: {
      ...nextState.runtime,
      narrativePending: (nextState.runtime.narrativePending ?? []).filter(
        (p) => p.id !== pendingId,
      ),
      eventLog: [...nextState.runtime.eventLog, logEntry],
    },
  };
};

/** Returns a difficulty multiplier (1.0–2.0) that grows with game time and player threat level. */
const getDifficultyScaleFactor = (state: GameState): number => {
  const bal = balance as unknown as Record<string, number>;
  const maxHours = bal.difficultyScaleMaxHours ?? 2000;
  const maxFactor = bal.difficultyScaleMaxFactor ?? 2.0;
  const supportWeight = bal.difficultyScalePopularSupportWeight ?? 0.5;

  const timeFactor = Math.min(1, state.runtime.nowHours / maxHours);

  const activeLocs = state.data.locations.filter((l) => !l.disabled);
  const avgSupport = activeLocs.length > 0
    ? activeLocs.reduce((s, l) => s + l.attributes.popularSupport, 0) / activeLocs.length
    : 0;
  const supportFactor = avgSupport / 100;

  const raw = timeFactor * (1 - supportWeight) + supportFactor * supportWeight;
  return 1 + raw * (maxFactor - 1);
};

const tickEnemyActivity = (state: GameState): GameState => {
  const now = state.runtime.nowHours;
  const bal = balance as unknown as Record<string, number>;
  const baseInterval = bal.enemyActionIntervalBaseHours ?? 48;
  const variance = bal.enemyActionIntervalVarianceHours ?? 24;
  const speedFactor = bal.enemyActionGarrisonSpeedFactor ?? 0.4;
  const scaleFactor = getDifficultyScaleFactor(state);
  const patrolInc = Math.round((bal.enemyPatrolIncrease ?? 5) * scaleFactor);
  const supportDec = Math.round((bal.enemySupportDecrease ?? 5) * scaleFactor);

  let nextState = state;

  for (const location of state.data.locations) {
    if (location.disabled) continue;

    const truth = getLocationTruth(nextState, location.id);

    // Initialize timer on first encounter
    const nextActionHours =
      truth.nextEnemyActionHours ??
      now + Math.random() * baseInterval;

    if (now < nextActionHours) continue;

    const action = pickEnemyAction(nextState, location.id);
    const result = applyEnemyAction(nextState, location, action, now, patrolInc, supportDec);
    nextState = result.state;

    // Schedule next action — higher garrison and difficulty = shorter interval
    const nextInterval = Math.max(
      12,
      (baseInterval / scaleFactor) - location.attributes.garrisonStrength * speedFactor + Math.random() * variance,
    );
    nextState = setLocationTruthRuntime(nextState, location.id, {
      ...getLocationTruth(nextState, location.id),
      nextEnemyActionHours: now + nextInterval,
    });

    // Intel-gate strategic events; arrest and counter-op are always visible
    if (result.event) {
      const hasIntel =
        Object.keys(nextState.runtime.knowledge?.byLocation?.[location.id] ?? {}).length > 0;
      const alwaysVisible = action === "arrest" || action === "counter-op";
      if (hasIntel || alwaysVisible) {
        nextState = {
          ...nextState,
          runtime: {
            ...nextState.runtime,
            eventLog: [...nextState.runtime.eventLog, result.event],
          },
        };
      }
    }
  }

  return nextState;
};

/** Checks victory/defeat conditions and returns updated state if phase changed. */
const checkGamePhase = (state: GameState): GameState => {
  // Don't re-check if already ended
  if (state.runtime.phase && state.runtime.phase !== "active") return state;

  // Defeat: all personnel gone (only if roster is non-empty)
  if (state.runtime.personnel.length > 0) {
    const allGone = state.runtime.personnel.every(
      (p) => p.status === "killed" || p.status === "captured" || p.status === "mia",
    );
    if (allGone) {
      return {
        ...state,
        runtime: { ...state.runtime, phase: "defeat", phaseReason: "all-agents-gone" },
      };
    }
  }

  // Defeat: HQ popular support at 0
  const hq = state.data.locations.find((l) => l.id === state.runtime.headquartersId);
  if (hq && hq.attributes.popularSupport <= 0) {
    return {
      ...state,
      runtime: { ...state.runtime, phase: "defeat", phaseReason: "hq-lost" },
    };
  }

  // Victory: average popular support across enabled locations
  const activeLocs = state.data.locations.filter((l) => !l.disabled);
  if (activeLocs.length > 0) {
    const avg =
      activeLocs.reduce((s, l) => s + l.attributes.popularSupport, 0) / activeLocs.length;
    const threshold =
      (balance as { victoryPopularSupportThreshold?: number }).victoryPopularSupportThreshold ?? 90;
    if (avg >= threshold) {
      return {
        ...state,
        runtime: { ...state.runtime, phase: "victory", phaseReason: "popular-support" },
      };
    }
  }

  return state;
};

