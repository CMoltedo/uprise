import type {
  GameState,
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
} from "./models.js";
import { generatePersonnel } from "./generators.js";
import balance from "./data/balance.json";
import intelDefsData from "./data/intel_defs.json";

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

export const getMissionSuccessChance = (
  plan: MissionPlan,
  personnel: Personnel[],
) => {
  const baseChance = plan.baseSuccessChance;
  const traitModifier = getTraitSuccessModifier(personnel);
  const roleModifier = getRoleSuccessModifier(personnel);
  const totalModifier = traitModifier.total + roleModifier.total;
  const chance = clampChance(baseChance + totalModifier);
  return {
    chance,
    baseChance,
    traitModifier,
    roleModifier,
    totalModifier,
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
  };
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
    default:
      return 0;
  }
};

const isTruthKeyNumeric = (key: string): boolean =>
  key === "garrisonStrength" || key === "patrolFrequency" || key === "customsScrutiny";

const INTEL_KEY_LABEL: Record<string, string> = {
  customsScrutiny: "Customs",
  patrolFrequency: "Patrols",
  garrisonStrength: "Garrison",
  enemyAgents: "Enemy agents",
  enemyMissions: "Enemy missions",
  specialHooks: "Special hooks",
};

const INTEL_DISPLAY_ORDER = [
  "customsScrutiny",
  "patrolFrequency",
  "garrisonStrength",
  "enemyAgents",
  "enemyMissions",
  "specialHooks",
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
    plan.availability?.type === "global"
      ? "galaxy"
      : locationId ?? personnel[0].locationId;
  const errors = validateAssignment(state, plan, personnel, targetLocationId);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const mission: MissionInstance = {
    id: `mission-${Date.now()}`,
    planId: plan.id,
    locationId: targetLocationId,
    assignedPersonnelIds: personnelIds,
    status: "active",
    remainingHours: plan.durationHours,
    startedAtHours: state.runtime.nowHours,
  };

  const offerToConsume =
    plan.availability?.type === "global"
      ? null
      : getActiveOffer(state, plan.id, targetLocationId);

  return {
    ...state,
    runtime: {
      ...state.runtime,
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

const resolveMission = (
  state: GameState,
  mission: MissionInstance,
): GameState => {
  const plan = getMissionPlan(state, mission.planId);
  if (!plan) {
    return state;
  }

  const assignedPersonnel = state.runtime.personnel.filter((person) =>
    mission.assignedPersonnelIds.includes(person.id),
  );
  const { chance: successChance } = getMissionSuccessChance(plan, assignedPersonnel);
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

  const injuryChance = balance.missionFailureInjuryChance ?? 0.05;
  const nextStatus: PersonnelStatus =
    success || Math.random() > injuryChance ? "idle" : "wounded";
  const updatedPersonnel = state.runtime.personnel.map((person) => {
    if (!mission.assignedPersonnelIds.includes(person.id)) {
      return person;
    }

    return {
      ...person,
      status: nextStatus,
    };
  });

  const updatedMission: MissionInstance = {
    ...mission,
    status: success ? "resolved" : "failed",
    remainingHours: 0,
  };

  let intelReport: { summary: string; keys: string[] } | undefined;
  let stateAfterRewards: GameState = {
    ...state,
    runtime: {
      ...state.runtime,
      resources: rewardResult.resources,
      materials: rewardResult.materials,
      personnel: updatedPersonnel,
      missions: state.runtime.missions.map((item) =>
        item.id === mission.id ? updatedMission : item,
      ),
    },
  };
  if (
    success &&
    plan.intelRewards &&
    plan.intelRewards.target === "location" &&
    mission.locationId !== "galaxy"
  ) {
    const { nextState: withIntel, summary } = applyIntelRewards(
      stateAfterRewards,
      mission.locationId,
      plan.intelRewards.keys,
      plan.intelRewards.quality,
    );
    stateAfterRewards = withIntel;
    intelReport = { summary, keys: plan.intelRewards.keys };
  }

  const roleGained: Array<{ personnelId: string; roleId: string }> = [];
  let personnelAfterRoleGains = stateAfterRewards.runtime.personnel;
  let trainingAttemptsWithoutGain: Record<string, Record<string, number>> = {
    ...(state.runtime.trainingAttemptsWithoutGain ?? {}),
  };

  if (success) {
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
      const roleId = plan.trainingReward.roleId;
      const baseChance = (balance as { trainingBaseRoleChance?: number }).trainingBaseRoleChance ?? 0.12;
      const increment = (balance as { trainingRoleChanceIncrementPerAttempt?: number }).trainingRoleChanceIncrementPerAttempt ?? 0.08;
      for (const personnelId of mission.assignedPersonnelIds) {
        const person = personnelAfterRoleGains.find((p) => p.id === personnelId);
        if (!person || person.roles.includes(roleId)) continue;
        if (person.roles.length >= MAX_PERSONNEL_ROLES) continue;
        const attempts =
          trainingAttemptsWithoutGain[personnelId]?.[plan.id] ?? 0;
        const chance = Math.min(
          1,
          baseChance + attempts * increment,
        );
        if (Math.random() < chance) {
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
      if (nextStatus === "wounded" && person) {
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
    rewardsApplied: rewardResult.applied,
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
        const arrivalEvent: TravelEvent = {
          id: `event-${Date.now()}`,
          kind: "travel",
          personnelId: assignment.personnelId,
          fromLocationId: assignment.fromLocationId,
          toLocationId: assignment.toLocationId,
          status: "arrived",
          atHours: nextState.runtime.nowHours,
          travelHours: originalTravelHours,
        };
        nextState = {
          ...nextState,
          runtime: {
            ...nextState.runtime,
            personnel: nextState.runtime.personnel.map((person) =>
              person.id === assignment.personnelId
                ? {
                    ...person,
                    locationId: assignment.toLocationId,
                    status: "idle",
                  }
                : person,
            ),
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
  return updateMissionOffers(nextState);
};

export const refreshMissionOffers = (state: GameState): GameState =>
  updateMissionOffers(state);

