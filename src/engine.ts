import type {
  GameState,
  MaterialCatalogItem,
  MaterialItem,
  MaterialRewardTable,
  MissionTypeConfig,
  MissionEvent,
  TravelEvent,
  MissionOffer,
  LocationAssignment,
  MissionInstance,
  MissionPlan,
  MissionMaterialRequirement,
  Personnel,
  PersonnelSkill,
  PersonnelStatus,
  ResourceBundle,
  TravelAssignment,
} from "./models.js";
import { generatePersonnel } from "./generators.js";

const DEFAULT_RESOURCES: ResourceBundle = {
  credits: 0,
  materials: 0,
  intel: 0,
};

const clampChance = (chance: number) => Math.max(0, Math.min(1, chance));

const mergeResources = (
  base: ResourceBundle,
  delta?: Partial<ResourceBundle>,
): ResourceBundle => {
  if (!delta) {
    return { ...base };
  }
  return {
    credits: base.credits + (delta.credits ?? 0),
    materials: base.materials + (delta.materials ?? 0),
    intel: base.intel + (delta.intel ?? 0),
  };
};

export const getLocation = (state: GameState, locationId: string) =>
  state.data.locations.find((location) => location.id === locationId);

export const getMissionPlan = (state: GameState, planId: string) =>
  state.data.missionPlans.find((plan) => plan.id === planId);

export const getPersonnel = (state: GameState, personnelId: string) =>
  state.runtime.personnel.find((person) => person.id === personnelId);

export const getMaterialRewardTable = (
  state: GameState,
  tableId?: string,
): MaterialRewardTable | undefined =>
  tableId
    ? state.data.materialRewardTables.find((table) => table.id === tableId)
    : undefined;

export const getMissionTypeConfig = (
  state: GameState,
  missionType: MissionPlan["type"],
): MissionTypeConfig | undefined =>
  state.data.missionTypeConfigs.find((config) => config.type === missionType);

export const getMaterialCatalogItem = (
  state: GameState,
  materialId: string,
): MaterialCatalogItem | undefined =>
  state.data.materialCatalog.find((item) => item.id === materialId);

const getMaterialRewardTableForPlan = (
  state: GameState,
  plan: MissionPlan,
): MaterialRewardTable | undefined => {
  if (plan.materialRewardTableId) {
    return getMaterialRewardTable(state, plan.materialRewardTableId);
  }
  const typeConfig = getMissionTypeConfig(state, plan.type);
  return getMaterialRewardTable(state, typeConfig?.defaultMaterialRewardTableId);
};

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
    const consume = roll <= requirement.consumeChance;
    const consumedQty = consume ? requirement.quantity : 0;
    return {
      ...item,
      quantity: Math.max(0, item.quantity - consumedQty),
    };
  });
};

export const getMaterialRewardModifier = (
  state: GameState,
  locationId: string,
): number => {
  const location = getLocation(state, locationId);
  if (!location) {
    return 1;
  }
  const { resistance, customsScrutiny, garrisonStrength, techLevel } =
    location.attributes;
  const pressure = (customsScrutiny + garrisonStrength) / 2;
  const base = 1 + (resistance - pressure) / 200 + techLevel / 500;
  return Math.max(0.5, Math.min(1.5, base));
};

const applyMaterialRewards = (
  state: GameState,
  plan: MissionPlan,
  locationId: string,
): GameState => {
  const table = getMaterialRewardTableForPlan(state, plan);
  if (!table || table.entries.length === 0) {
    return state;
  }
  const modifier = getMaterialRewardModifier(state, locationId);
  let nextMaterials = [...state.runtime.materials];
  for (const entry of table.entries) {
    const chance = Math.max(0, Math.min(1, entry.baseChance * modifier));
    if (Math.random() > chance) {
      continue;
    }
    const existing = nextMaterials.find((item) => item.id === entry.materialId);
    if (existing) {
      existing.quantity += entry.quantity;
    } else {
      const catalogItem = getMaterialCatalogItem(state, entry.materialId);
      nextMaterials = [
        ...nextMaterials,
        {
          id: entry.materialId,
          name: catalogItem?.name ?? entry.materialId,
          quantity: entry.quantity,
        },
      ];
    }
  }
  return nextMaterials === state.runtime.materials
    ? state
    : { ...state, runtime: { ...state.runtime, materials: nextMaterials } };
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

  if (plan.requiredSkills.length > 0) {
    const required = new Set<PersonnelSkill>(plan.requiredSkills);
    const hasMatch = personnel.some((person) =>
      person.skills.some((skill) => required.has(skill)),
    );
    if (!hasMatch) {
      errors.push(`Missing skills: ${plan.requiredSkills.join(", ")}`);
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

  const successChance = clampChance(plan.baseSuccessChance);
  const roll = Math.random();
  const success = roll <= successChance;

  const rewards = success ? plan.rewards : plan.penalties ?? DEFAULT_RESOURCES;
  const updatedResources = mergeResources(state.runtime.resources, rewards);

  const nextStatus: PersonnelStatus =
    success || Math.random() > 0.05 ? "idle" : "wounded";
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

  const event: MissionEvent = {
    id: `event-${Date.now()}`,
    kind: "mission",
    missionId: mission.id,
    planId: mission.planId,
    status: updatedMission.status,
    resolvedAtHours: state.runtime.nowHours,
    success,
    personnelIds: [...mission.assignedPersonnelIds],
    rewardsApplied: rewards,
    locationId: mission.locationId,
  };

  let nextState: GameState = {
    ...state,
    runtime: {
      ...state.runtime,
      resources: updatedResources,
      personnel: updatedPersonnel,
      missions: state.runtime.missions.map((item) =>
        item.id === mission.id ? updatedMission : item,
      ),
      eventLog: [...state.runtime.eventLog, event],
    },
  };
  if (success) {
    nextState = applyMaterialRewards(nextState, plan, mission.locationId);
    if (plan.type === "recruit-allies") {
      nextState = applyRecruitRewards(nextState, mission.locationId, 1);
    }
  }
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

