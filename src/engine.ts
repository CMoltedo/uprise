import type {
  GameState,
  MaterialItem,
  MissionEvent,
  TravelEvent,
  MissionInstance,
  MissionPlan,
  MissionMaterialRequirement,
  Personnel,
  PersonnelRole,
  PersonnelStatus,
  ResourceBundle,
  TravelAssignment,
} from "./models.js";

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

export const getMissionPlan = (state: GameState, planId: string) =>
  state.missionPlans.find((plan) => plan.id === planId);

export const getPersonnel = (state: GameState, personnelId: string) =>
  state.personnel.find((person) => person.id === personnelId);

const hasMaterials = (
  state: GameState,
  requirements?: MissionMaterialRequirement[],
): string[] => {
  const errors: string[] = [];
  if (!requirements || requirements.length === 0) {
    return errors;
  }
  for (const requirement of requirements) {
    const material = state.materials.find(
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

export const validateAssignment = (
  state: GameState,
  plan: MissionPlan,
  personnel: Personnel[],
): string[] => {
  const errors: string[] = [];
  for (const person of personnel) {
    if (person.status !== "idle") {
      errors.push(`${person.name} is not idle`);
    }
    if (plan.availability.type === "location") {
      if (person.locationId !== plan.availability.locationId) {
        errors.push(`${person.name} is not at ${plan.availability.locationId}`);
      }
    }
  }

  const rolesNeeded = new Set<PersonnelRole>(plan.requiredRoles);
  for (const person of personnel) {
    rolesNeeded.delete(person.role);
  }
  if (rolesNeeded.size > 0) {
    errors.push(`Missing roles: ${Array.from(rolesNeeded).join(", ")}`);
  }
  if (plan.availability.type === "time") {
    if (
      state.nowHours < plan.availability.startHours ||
      state.nowHours > plan.availability.endHours
    ) {
      errors.push("Mission is not available at this time.");
    }
  }
  errors.push(...hasMaterials(state, plan.requiredMaterials));
  return errors;
};

export const assignPersonnelToMission = (
  state: GameState,
  planId: string,
  personnelIds: string[],
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

  const errors = validateAssignment(state, plan, personnel);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const mission: MissionInstance = {
    id: `mission-${Date.now()}`,
    planId: plan.id,
    assignedPersonnelIds: personnelIds,
    status: "active",
    remainingHours: plan.durationHours,
    startedAtHours: state.nowHours,
  };

  return {
    ...state,
    personnel: state.personnel.map((person) =>
      personnelIds.includes(person.id)
        ? {
            ...person,
            status: "assigned",
          }
        : person,
    ),
    materials: consumeMaterials(state.materials, plan.requiredMaterials),
    missions: [...state.missions, mission],
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
    startedAtHours: state.nowHours,
  };

  const event: TravelEvent = {
    id: `event-${Date.now()}`,
    kind: "travel",
    personnelId,
    fromLocationId: person.locationId,
    toLocationId,
    status: "started",
    atHours: state.nowHours,
  };

  return {
    ...state,
    personnel: state.personnel.map((item) =>
      item.id === personnelId ? { ...item, status: "traveling" } : item,
    ),
    travel: [...state.travel, travel],
    eventLog: [...state.eventLog, event],
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
  const updatedResources = mergeResources(state.resources, rewards);

  const nextStatus: PersonnelStatus = success ? "idle" : "wounded";
  const updatedPersonnel = state.personnel.map((person) => {
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
    resolvedAtHours: state.nowHours,
    success,
    personnelIds: [...mission.assignedPersonnelIds],
    rewardsApplied: rewards,
  };

  return {
    ...state,
    resources: updatedResources,
    personnel: updatedPersonnel,
    missions: state.missions.map((item) =>
      item.id === mission.id ? updatedMission : item,
    ),
    eventLog: [...state.eventLog, event],
  };
};

export const advanceTime = (state: GameState, hours: number): GameState => {
  if (hours <= 0) {
    return state;
  }

  let nextState = { ...state, nowHours: state.nowHours + hours };
  for (const mission of nextState.missions) {
    if (mission.status !== "active") {
      continue;
    }

    const remaining = mission.remainingHours - hours;
    if (remaining <= 0) {
      nextState = resolveMission(nextState, mission);
    } else {
      nextState = {
        ...nextState,
        missions: nextState.missions.map((item) =>
          item.id === mission.id
            ? { ...item, remainingHours: remaining }
            : item,
        ),
      };
    }
  }

  if (nextState.travel.length > 0) {
    for (const assignment of nextState.travel) {
      const remaining = assignment.remainingHours - hours;
      if (remaining <= 0) {
        const arrivalEvent: TravelEvent = {
          id: `event-${Date.now()}`,
          kind: "travel",
          personnelId: assignment.personnelId,
          fromLocationId: assignment.fromLocationId,
          toLocationId: assignment.toLocationId,
          status: "arrived",
          atHours: nextState.nowHours,
        };
        nextState = {
          ...nextState,
          personnel: nextState.personnel.map((person) =>
            person.id === assignment.personnelId
              ? {
                  ...person,
                  locationId: assignment.toLocationId,
                  status: "idle",
                }
              : person,
          ),
          travel: nextState.travel.filter((item) => item.id !== assignment.id),
          eventLog: [...nextState.eventLog, arrivalEvent],
        };
      } else {
        nextState = {
          ...nextState,
          travel: nextState.travel.map((item) =>
            item.id === assignment.id
              ? { ...item, remainingHours: remaining }
              : item,
          ),
        };
      }
    }
  }
  return nextState;
};

export const saveState = (state: GameState): string =>
  JSON.stringify(state, null, 2);

export const loadState = (raw: string): GameState => {
  const parsed = JSON.parse(raw) as GameState;
  return parsed;
};
