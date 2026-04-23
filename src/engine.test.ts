import { describe, it, expect } from "vitest";
import * as engine from "./engine.js";
import type { GameState, Personnel, MissionPlan, Location } from "./models.js";

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function makePersonnel(overrides: Partial<Personnel> = {}): Personnel {
  return {
    id: "p1",
    name: "Test Agent",
    roles: ["combat"],
    immutableTraits: [],
    mutableTraits: [],
    status: "idle",
    locationId: "loc1",
    ...overrides,
  };
}

function makePlan(overrides: Partial<MissionPlan> = {}): MissionPlan {
  return {
    id: "plan1",
    name: "Test Mission",
    summary: "",
    type: "logistics",
    requiredRoles: ["combat"],
    durationHours: 8,
    baseSuccessChance: 0.7,
    ...overrides,
  };
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: "loc1",
    name: "Base",
    tags: [],
    planetId: "planet1",
    position: { x: 0, y: 0 },
    attributes: {
      resistance: 50,
      healthcareFacilities: 80,
      techLevel: 60,
      populationDensity: 40,
      customsScrutiny: 20,
      patrolFrequency: 30,
      garrisonStrength: 25,
      popularSupport: 70,
    },
    ...overrides,
  };
}

function makeState(
  overrides: {
    personnel?: Personnel[];
    locations?: Location[];
    plans?: MissionPlan[];
    nowHours?: number;
  } = {},
): GameState {
  return {
    data: {
      materialCatalog: [],
      heroes: [],
      sectors: [],
      planets: [
        {
          id: "planet1",
          name: "Planet",
          sectorId: "sec1",
          tags: [],
          position: { x: 0, y: 0 },
        },
      ],
      locations: overrides.locations ?? [makeLocation()],
      missionPlans: overrides.plans ?? [makePlan()],
      locationAssignments: [],
    },
    runtime: {
      faction: "rebels",
      nowHours: overrides.nowHours ?? 0,
      headquartersId: "loc1",
      resources: { credits: 1000, intel: 100 },
      personnel: overrides.personnel ?? [makePersonnel()],
      materials: [],
      missions: [],
      missionOffers: [],
      travel: [],
      eventLog: [],
      locationTruth: {},
      knowledge: { byLocation: {} },
    },
  };
}

// ---------------------------------------------------------------------------
// getMissionSuccessChance
// ---------------------------------------------------------------------------

describe("getMissionSuccessChance", () => {
  it("returns a value within [0, 1]", () => {
    const plan = makePlan({ baseSuccessChance: 0.6 });
    const person = makePersonnel({ roles: ["combat"], immutableTraits: [], mutableTraits: [] });
    const { chance } = engine.getMissionSuccessChance(plan, [person]);
    expect(chance).toBeGreaterThanOrEqual(0);
    expect(chance).toBeLessThanOrEqual(1);
  });

  it("clamps to 1 when base chance is very high", () => {
    const plan = makePlan({ baseSuccessChance: 0.99 });
    const { chance } = engine.getMissionSuccessChance(plan, []);
    expect(chance).toBeLessThanOrEqual(1);
  });

  it("clamps to 0 when base chance is very low", () => {
    const plan = makePlan({ baseSuccessChance: 0.001 });
    const { chance: low } = engine.getMissionSuccessChance(plan, []);
    expect(low).toBeGreaterThanOrEqual(0);
  });

  it("includes baseChance in the returned breakdown", () => {
    const plan = makePlan({ baseSuccessChance: 0.55 });
    const { baseChance } = engine.getMissionSuccessChance(plan, []);
    expect(baseChance).toBe(0.55);
  });

  it("is at least as high with positive-modifier trait (lucky) vs. no traits", () => {
    const plan = makePlan({ baseSuccessChance: 0.5 });
    const base = engine.getMissionSuccessChance(plan, [makePersonnel()]).chance;
    const boosted = engine.getMissionSuccessChance(plan, [makePersonnel({ immutableTraits: ["lucky"] })]).chance;
    expect(boosted).toBeGreaterThanOrEqual(base);
  });
});

// ---------------------------------------------------------------------------
// getMissionOperationalRisk
// ---------------------------------------------------------------------------

describe("getMissionOperationalRisk", () => {
  it("returns a value clamped to [0, 1]", () => {
    const state = makeState();
    const plan = makePlan({ baseRiskRating: 0.3 });
    const risk = engine.getMissionOperationalRisk(state, plan, "loc1", []);
    expect(risk).toBeGreaterThanOrEqual(0);
    expect(risk).toBeLessThanOrEqual(1);
  });

  it("is higher at a hostile location than a calm one", () => {
    const calm = makeLocation({
      id: "calm",
      attributes: { ...makeLocation().attributes, garrisonStrength: 5, patrolFrequency: 5, customsScrutiny: 5 },
    });
    const hostile = makeLocation({
      id: "hostile",
      attributes: { ...makeLocation().attributes, garrisonStrength: 90, patrolFrequency: 90, customsScrutiny: 90 },
    });
    const state = makeState({ locations: [calm, hostile] });
    const plan = makePlan({ baseRiskRating: 0.3 });
    const calmRisk = engine.getMissionOperationalRisk(state, plan, "calm", []);
    const hostileRisk = engine.getMissionOperationalRisk(state, plan, "hostile", []);
    expect(hostileRisk).toBeGreaterThan(calmRisk);
  });

  it("is reduced by a veteran agent compared to a novice", () => {
    const state = makeState();
    const plan = makePlan({ baseRiskRating: 0.5, requiredRoles: ["combat"] });
    const novice = makePersonnel({ roles: ["combat"], roleLevels: { combat: 1 } });
    const veteran = makePersonnel({ roles: ["combat"], roleLevels: { combat: 5 } });
    const noviceRisk = engine.getMissionOperationalRisk(state, plan, "loc1", [novice]);
    const vetRisk = engine.getMissionOperationalRisk(state, plan, "loc1", [veteran]);
    expect(vetRisk).toBeLessThanOrEqual(noviceRisk);
  });

  it("increases with higher baseRiskRating", () => {
    const state = makeState();
    const lowRisk = engine.getMissionOperationalRisk(state, makePlan({ baseRiskRating: 0.1 }), "loc1", []);
    const highRisk = engine.getMissionOperationalRisk(state, makePlan({ baseRiskRating: 0.8 }), "loc1", []);
    expect(highRisk).toBeGreaterThan(lowRisk);
  });
});

// ---------------------------------------------------------------------------
// rollAdverseOutcome
// ---------------------------------------------------------------------------
//
// With default balance (adverseScale=0.85, failureOutcomeShift=0.25):
//   effectiveRisk=0.2, success=true  → totalAdverse=0.17, safe below roll 0.83
//   effectiveRisk=0.4, success=false → totalAdverse=min(1, 0.34+0.25)=0.59
//   killedThreshold = 0.7

describe("rollAdverseOutcome", () => {
  it("returns 'safe' when rng roll is well below the adverse threshold", () => {
    // risk=0.2, success=true → safe threshold = 1 - (0.2*0.85) = 0.83
    // roll=0 → safe
    const result = engine.rollAdverseOutcome(0.2, true, () => 0);
    expect(result).toBe("safe");
  });

  it("returns an adverse outcome when rng roll is at 1.0 with moderate risk", () => {
    // roll=1.0 is always adverse regardless of risk
    const result = engine.rollAdverseOutcome(0.4, true, () => 1);
    expect(result).not.toBe("safe");
  });

  it("never returns 'killed' when effectiveRisk is below the 0.7 threshold", () => {
    // Sweep the full range of rolls at risk=0.4 (below killed threshold)
    for (let i = 0; i <= 100; i++) {
      const result = engine.rollAdverseOutcome(0.4, false, () => i / 100);
      expect(result).not.toBe("killed");
    }
  });

  it("can return 'killed' when effectiveRisk >= 0.7 and roll hits the killed bucket", () => {
    // risk=0.8 ≥ 0.7 threshold; roll=1.0 lands at the far end of the adverse range
    const result = engine.rollAdverseOutcome(0.8, false, () => 1);
    expect(result).toBe("killed");
  });

  it("failure shifts the outcome toward adverse more than success at the same roll", () => {
    // At roll=0.75, risk=0.3:
    //   success: totalAdverse=0.255, safe below 0.745 → roll 0.75 is adverse (barely)
    //   failure: totalAdverse=0.505, safe below 0.495 → roll 0.75 is definitely adverse
    // Both are adverse here, but failure should not produce "safe" when success also doesn't
    const severity: Record<string, number> = { safe: 0, wounded: 1, captured: 2, mia: 3, killed: 4 };
    const onSuccess = engine.rollAdverseOutcome(0.3, true, () => 0.75);
    const onFailure = engine.rollAdverseOutcome(0.3, false, () => 0.75);
    expect(severity[onFailure] ?? 0).toBeGreaterThanOrEqual(severity[onSuccess] ?? 0);
  });

  it("returns 'wounded' for a roll just above safe threshold (proportional to injury factor)", () => {
    // risk=0.4, success=true → totalAdverse=0.34, safe threshold=0.66
    // roll just above threshold (e.g. 0.67) should hit the first bucket: wounded
    // adverseRoll = (0.67 - 0.66) / 0.34 ≈ 0.029, which is < injuryF/sumF
    // injuryF=0.25, sum=0.39, injuryEnd≈0.641 → 0.029 < 0.641 → wounded
    const result = engine.rollAdverseOutcome(0.4, true, () => 0.67);
    expect(result).toBe("wounded");
  });
});

// ---------------------------------------------------------------------------
// getLocationRiskFactor
// ---------------------------------------------------------------------------

describe("getLocationRiskFactor", () => {
  it("returns a positive number", () => {
    const state = makeState();
    expect(engine.getLocationRiskFactor(state, "loc1")).toBeGreaterThan(0);
  });

  it("is higher at a location with maxed hostile attributes", () => {
    const base = engine.getLocationRiskFactor(makeState(), "loc1");
    const hostile = makeLocation({
      attributes: { ...makeLocation().attributes, garrisonStrength: 100, patrolFrequency: 100, customsScrutiny: 100 },
    });
    const hostileState = makeState({ locations: [hostile] });
    expect(engine.getLocationRiskFactor(hostileState, "loc1")).toBeGreaterThan(base);
  });

  it("is lower when resistance and popular support are maximized and hostiles are zero", () => {
    const friendly = makeLocation({
      attributes: {
        ...makeLocation().attributes,
        garrisonStrength: 0,
        patrolFrequency: 0,
        customsScrutiny: 0,
        resistance: 100,
        popularSupport: 100,
      },
    });
    const base = engine.getLocationRiskFactor(makeState(), "loc1");
    const friendlyState = makeState({ locations: [friendly] });
    expect(engine.getLocationRiskFactor(friendlyState, "loc1")).toBeLessThan(base);
  });

  it("returns 1.0 for an unknown location id (no location found)", () => {
    const state = makeState();
    // Engine falls back to 1.0 when location not found
    expect(engine.getLocationRiskFactor(state, "does-not-exist")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// validateAssignment
// ---------------------------------------------------------------------------

describe("validateAssignment", () => {
  it("returns no errors for a valid assignment", () => {
    // Global plans bypass the offer check; non-global plans require an active MissionOffer
    const plan = makePlan({ requiredRoles: ["combat"], availability: { type: "global" } });
    const person = makePersonnel({ status: "idle", locationId: "loc1", roles: ["combat"] });
    const state = makeState({ personnel: [person], plans: [plan] });
    const errors = engine.validateAssignment(state, plan, [person], "loc1");
    expect(errors).toHaveLength(0);
  });

  it("returns an error when no personnel are provided", () => {
    const plan = makePlan({ requiredRoles: ["combat"] });
    const state = makeState({ personnel: [] });
    const errors = engine.validateAssignment(state, plan, [], "loc1");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns an error when the assigned agent is wounded (not idle)", () => {
    const plan = makePlan({ requiredRoles: ["combat"] });
    const person = makePersonnel({ status: "wounded", locationId: "loc1", roles: ["combat"] });
    const state = makeState({ personnel: [person], plans: [plan] });
    const errors = engine.validateAssignment(state, plan, [person], "loc1");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns an error when the required role is not covered by any assigned agent", () => {
    const plan = makePlan({ requiredRoles: ["espionage"] });
    const person = makePersonnel({ roles: ["combat"] });
    const state = makeState({ personnel: [person], plans: [plan] });
    const errors = engine.validateAssignment(state, plan, [person], "loc1");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns a capture-related error for rescue when no captured agents at location", () => {
    const plan = makePlan({ type: "rescue", requiredRoles: ["combat", "espionage"] });
    const person = makePersonnel({ roles: ["combat", "espionage"], status: "idle" });
    const state = makeState({ personnel: [person], plans: [plan] });
    const errors = engine.validateAssignment(state, plan, [person], "loc1");
    expect(errors.some((e) => e.toLowerCase().includes("captured"))).toBe(true);
  });

  it("returns an MIA-related error for search when no MIA agents at location", () => {
    const plan = makePlan({ type: "search", requiredRoles: ["espionage", "operations"] });
    const person = makePersonnel({ roles: ["espionage", "operations"], status: "idle" });
    const state = makeState({ personnel: [person], plans: [plan] });
    const errors = engine.validateAssignment(state, plan, [person], "loc1");
    expect(errors.some((e) => e.toLowerCase().includes("mia"))).toBe(true);
  });

  it("passes rescue validation when a captured agent exists at the target location", () => {
    const plan = makePlan({ type: "rescue", requiredRoles: ["combat", "espionage"], availability: { type: "global" } });
    const rescuer = makePersonnel({ id: "rescuer", roles: ["combat", "espionage"], status: "idle" });
    const prisoner = makePersonnel({
      id: "prisoner",
      roles: ["combat"],
      status: "captured",
      capturedLocationId: "loc1",
      locationId: "loc1",
    });
    const state = makeState({ personnel: [rescuer, prisoner], plans: [plan] });
    const errors = engine.validateAssignment(state, plan, [rescuer], "loc1");
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Trait / modifier helpers
// ---------------------------------------------------------------------------

describe("getTraitsForPerson", () => {
  it("combines immutable and mutable traits", () => {
    const person = makePersonnel({ immutableTraits: ["brave"], mutableTraits: ["lucky"] });
    expect(engine.getTraitsForPerson(person)).toEqual(["brave", "lucky"]);
  });

  it("returns empty array when no traits set", () => {
    const person = makePersonnel({ immutableTraits: [], mutableTraits: [] });
    expect(engine.getTraitsForPerson(person)).toEqual([]);
  });
});

describe("getPersonnelTraitCount", () => {
  it("counts immutable and mutable traits together", () => {
    const person = makePersonnel({ immutableTraits: ["a", "b"], mutableTraits: ["c"] });
    expect(engine.getPersonnelTraitCount(person)).toBe(3);
  });

  it("returns 0 when person has no traits", () => {
    const person = makePersonnel({ immutableTraits: [], mutableTraits: [] });
    expect(engine.getPersonnelTraitCount(person)).toBe(0);
  });
});

describe("getMutableTraitGainChanceMultiplier", () => {
  it("returns 1.0 at exactly 4 traits", () => {
    const person = makePersonnel({ immutableTraits: ["a", "b"], mutableTraits: ["c", "d"] });
    expect(engine.getMutableTraitGainChanceMultiplier(person)).toBe(1.0);
  });

  it("returns 1.0 at fewer than 4 traits", () => {
    const person = makePersonnel({ immutableTraits: ["a"], mutableTraits: [] });
    expect(engine.getMutableTraitGainChanceMultiplier(person)).toBe(1.0);
  });

  it("decreases below 1.0 when trait count exceeds 4", () => {
    const person = makePersonnel({ immutableTraits: ["a", "b", "c"], mutableTraits: ["d", "e", "f"] });
    expect(engine.getMutableTraitGainChanceMultiplier(person)).toBeLessThan(1.0);
  });

  it("returns 0 when trait count reaches MAX_TRAITS (8)", () => {
    // At exactly MAX_TRAITS the engine returns 0 to prevent further gains
    const person = makePersonnel({
      immutableTraits: ["a", "b", "c"],
      mutableTraits: ["d", "e", "f", "g", "h"], // 3 + 5 = 8 = MAX_TRAITS
    });
    expect(engine.getMutableTraitGainChanceMultiplier(person)).toBe(0);
  });
});

describe("getTraitSuccessModifier", () => {
  it("returns total of 0 when personnel have no traits", () => {
    const result = engine.getTraitSuccessModifier([makePersonnel({ immutableTraits: [], mutableTraits: [] })]);
    expect(result.total).toBe(0);
  });

  it("returns a modifier summary with bonus, penalty, total", () => {
    const result = engine.getTraitSuccessModifier([makePersonnel()]);
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("bonus");
    expect(result).toHaveProperty("penalty");
  });
});

// ---------------------------------------------------------------------------
// getRecoveryDurationHours
// ---------------------------------------------------------------------------

describe("getRecoveryDurationHours", () => {
  it("returns a positive number", () => {
    const state = makeState();
    expect(engine.getRecoveryDurationHours(state, "loc1")).toBeGreaterThan(0);
  });

  it("is shorter at a high-tech, high-healthcare location than a primitive one", () => {
    const advanced = makeLocation({
      attributes: { ...makeLocation().attributes, techLevel: 100, healthcareFacilities: 100 },
    });
    const primitive = makeLocation({
      attributes: { ...makeLocation().attributes, techLevel: 0, healthcareFacilities: 0 },
    });
    const stateAdvanced = makeState({ locations: [advanced] });
    const statePrimitive = makeState({ locations: [primitive] });
    expect(engine.getRecoveryDurationHours(stateAdvanced, "loc1")).toBeLessThan(
      engine.getRecoveryDurationHours(statePrimitive, "loc1"),
    );
  });
});

// ---------------------------------------------------------------------------
// getTrainingDurationRange
// ---------------------------------------------------------------------------

describe("getTrainingDurationRange", () => {
  it("returns min and max hours both greater than zero", () => {
    const plan = makePlan({ type: "training", durationHours: 8 });
    const { minHours, maxHours } = engine.getTrainingDurationRange(plan);
    expect(minHours).toBeGreaterThan(0);
    expect(maxHours).toBeGreaterThan(0);
  });

  it("maxHours is greater than or equal to minHours", () => {
    const plan = makePlan({ type: "training", durationHours: 8 });
    const { minHours, maxHours } = engine.getTrainingDurationRange(plan);
    expect(maxHours).toBeGreaterThanOrEqual(minHours);
  });

  it("both values are larger than the base durationHours", () => {
    const plan = makePlan({ type: "training", durationHours: 8 });
    const { minHours, maxHours } = engine.getTrainingDurationRange(plan);
    expect(minHours).toBeGreaterThan(plan.durationHours);
    expect(maxHours).toBeGreaterThan(plan.durationHours);
  });
});
