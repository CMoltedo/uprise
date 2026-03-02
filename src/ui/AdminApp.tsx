import { useEffect, useMemo, useState } from "react";
import type {
  GameState,
  MissionPlan,
  MissionType,
  Personnel,
  PersonnelRole,
  Location,
  LocationAssignment,
  Planet,
  Sector,
} from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import balance from "../data/balance.json";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";
import { getTraitsForPerson, refreshMissionOffers } from "../engine.js";
import { parseSave, serializeSave } from "../persistence.js";

const ADMIN_CURRENT_DRAFT_KEY = "uprise-admin-current-draft";
const ADMIN_BASELINE_DRAFT_KEY = "uprise-admin-baseline-draft";
const ADMIN_CURRENT_APPLY_KEY = "uprise-admin-current-apply";

const loadInitialState = (mode: "current" | "baseline"): GameState => {
  const draftKey =
    mode === "baseline" ? ADMIN_BASELINE_DRAFT_KEY : ADMIN_CURRENT_DRAFT_KEY;
  const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
  if (mode === "baseline") {
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as GameState;
        if (parsed?.data && parsed?.runtime) {
          return parsed;
        }
      } catch {
        // ignore invalid baseline drafts
      }
    }
    return buildScenario(baseline);
  }
  const raw = localStorage.getItem(draftKey);
  const runtimeDraft = raw ? parseSave(raw) : null;
  const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
  if (runtimeDraft) {
    return refreshMissionOffers({ ...scenario, runtime: runtimeDraft });
  }
  return refreshMissionOffers(scenario);
};

export const AdminApp = () => {
  const [mode, setMode] = useState<"current" | "baseline">("current");
  const [state, setState] = useState<GameState>(() => loadInitialState("current"));
  const [selectedMissionId, setSelectedMissionId] = useState<string>(
    state.data.missionPlans[0]?.id ?? "",
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    state.data.locations[0]?.id ?? "",
  );
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>(
    state.runtime.personnel[0]?.id ?? "",
  );
  const [selectedPlanetId, setSelectedPlanetId] = useState<string>(
    state.data.planets[0]?.id ?? "",
  );
  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    state.data.sectors[0]?.id ?? "",
  );
  const [selectedRoleDefinitionId, setSelectedRoleDefinitionId] = useState<string>(
    ((balance as { personnelRoles?: string[] }).personnelRoles ?? [])[0] ?? "",
  );
  const [traitDefinitionTab, setTraitDefinitionTab] = useState<
    "immutable" | "mutable" | "class"
  >("immutable");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const isBaseline = mode === "baseline";

  useEffect(() => {
    const nextState = loadInitialState(mode);
    setState(nextState);
    setSelectedMissionId(nextState.data.missionPlans[0]?.id ?? "");
    setSelectedLocationId(nextState.data.locations[0]?.id ?? "");
    setSelectedPersonnelId(nextState.runtime.personnel[0]?.id ?? "");
    setSelectedPlanetId(nextState.data.planets[0]?.id ?? "");
    setSelectedSectorId(nextState.data.sectors[0]?.id ?? "");
    setSaveMessage("");
  }, [mode]);

  const selectedMission = useMemo(
    () => state.data.missionPlans.find((plan) => plan.id === selectedMissionId) ?? null,
    [state.data.missionPlans, selectedMissionId],
  );
  const selectedLocation = useMemo(
    () => state.data.locations.find((item) => item.id === selectedLocationId) ?? null,
    [state.data.locations, selectedLocationId],
  );
  const selectedPersonnel = useMemo(
    () =>
      state.runtime.personnel.find((item) => item.id === selectedPersonnelId) ??
      null,
    [state.runtime.personnel, selectedPersonnelId],
  );
  const selectedPlanet = useMemo(
    () => state.data.planets.find((p) => p.id === selectedPlanetId) ?? null,
    [state.data.planets, selectedPlanetId],
  );
  const selectedSector = useMemo(
    () => state.data.sectors.find((s) => s.id === selectedSectorId) ?? null,
    [state.data.sectors, selectedSectorId],
  );

  const updateMission = (planId: string, patch: Partial<MissionPlan>) => {
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        missionPlans: prev.data.missionPlans.map((plan) =>
          plan.id === planId ? { ...plan, ...patch } : plan,
        ),
      },
    }));
  };
  const updateLocation = (locationId: string, patch: Partial<Location>) => {
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        locations: prev.data.locations.map((location) =>
          location.id === locationId ? { ...location, ...patch } : location,
        ),
      },
    }));
  };
  const updatePersonnel = (personnelId: string, patch: Partial<Personnel>) => {
    setState((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        personnel: prev.runtime.personnel.map((person) =>
          person.id === personnelId ? { ...person, ...patch } : person,
        ),
      },
    }));
  };
  const updatePlanet = (planetId: string, patch: Partial<Planet>) => {
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        planets: prev.data.planets.map((planet) =>
          planet.id === planetId ? { ...planet, ...patch } : planet,
        ),
      },
    }));
  };
  const updateSector = (sectorId: string, patch: Partial<Sector>) => {
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        sectors: prev.data.sectors.map((sector) =>
          sector.id === sectorId ? { ...sector, ...patch } : sector,
        ),
      },
    }));
  };

  const upsertMissionLocationAssignment = (planId: string, locationId: string) => {
    setState((prev) => {
      if (locationId === "none") {
        return {
          ...prev,
          data: {
            ...prev.data,
            locationAssignments: prev.data.locationAssignments.filter(
              (assignment) => assignment.planId !== planId,
            ),
          },
        };
      }
      const existing = prev.data.locationAssignments.find(
        (assignment) => assignment.planId === planId,
      );
      if (existing) {
        return {
          ...prev,
          data: {
            ...prev.data,
            locationAssignments: prev.data.locationAssignments.map((assignment) =>
              assignment.id === existing.id
                ? { ...assignment, locationId }
                : assignment,
            ),
          },
        };
      }
      const newAssignment: LocationAssignment = {
        id: `assign-${planId}-${Date.now()}`,
        planId,
        locationId,
        appearanceChance: 0.05,
        windowHours: 24,
      };
      return {
        ...prev,
        data: {
          ...prev.data,
          locationAssignments: [...prev.data.locationAssignments, newAssignment],
        },
      };
    });
  };

  const saveDraft = () => {
    if (mode === "baseline") {
      localStorage.setItem(ADMIN_BASELINE_DRAFT_KEY, JSON.stringify(state, null, 2));
      setSaveMessage("Baseline draft saved.");
    } else {
      const payload = serializeSave(state.runtime);
      localStorage.setItem(ADMIN_CURRENT_DRAFT_KEY, payload);
      localStorage.setItem(ADMIN_CURRENT_APPLY_KEY, payload);
      setSaveMessage("Applied to running game.");
    }
    window.setTimeout(() => setSaveMessage(""), 1500);
  };

  const exportBaseline = async () => {
    const json = JSON.stringify(state, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setSaveMessage("Baseline JSON copied to clipboard.");
    } catch {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "baselineState.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setSaveMessage("Baseline JSON downloaded.");
    }
    window.setTimeout(() => setSaveMessage(""), 1500);
  };

  const addMission = () => {
    const id = `custom-mission-${Date.now()}`;
    const mission: MissionPlan = {
      id,
      name: "New Mission",
      summary: "Describe the mission.",
      type: "logistics",
      requiredRoles: [],
      durationHours: 12,
      baseSuccessChance: 0.5,
      rewards: {},
      penalties: {},
    };
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        missionPlans: [...prev.data.missionPlans, mission],
      },
    }));
    setSelectedMissionId(id);
  };

  const addLocation = () => {
    const id = `custom-location-${Date.now()}`;
    const planetId = state.data.planets[0]?.id ?? "";
    const location: Location = {
      id,
      name: "New Location",
      tags: [],
      planetId,
      position: { x: 50, y: 50 },
      attributes: {
        resistance: 40,
        healthcareFacilities: 50,
        techLevel: 50,
        populationDensity: 50,
        customsScrutiny: 50,
        patrolFrequency: 50,
        garrisonStrength: 50,
        popularSupport: 50,
      },
    };
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        locations: [...prev.data.locations, location],
      },
    }));
    setSelectedLocationId(id);
  };

  const addPlanet = () => {
    const id = `custom-planet-${Date.now()}`;
    const sectorId = state.data.sectors[0]?.id ?? "";
    const planet: Planet = {
      id,
      name: "New Planet",
      sectorId,
      tags: [],
      position: { x: 50, y: 50 },
    };
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        planets: [...prev.data.planets, planet],
      },
    }));
    setSelectedPlanetId(id);
  };

  const addSector = () => {
    const id = `custom-sector-${Date.now()}`;
    const sector: Sector = {
      id,
      name: "New Sector",
      tags: [],
      polygon: [],
    };
    setState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        sectors: [...prev.data.sectors, sector],
      },
    }));
    setSelectedSectorId(id);
  };

  const addPersonnel = () => {
    const id = `custom-personnel-${Date.now()}`;
    const locationId = state.data.locations[0]?.id ?? "";
    const person: Personnel = {
      id,
      name: "New Agent",
      roles: [],
      immutableTraits: [],
      mutableTraits: [],
      status: "idle",
      locationId,
    };
    setState((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        personnel: [...prev.runtime.personnel, person],
      },
    }));
    setSelectedPersonnelId(id);
  };

  return (
    <div className="page admin-page">
      <div className="admin-toolbar">
        <div>
          <h1>Admin Editor</h1>
          <div className="meta">Edit missions, locations, and agents.</div>
          <div className="admin-mode-toggle">
            <button
              type="button"
              className={`admin-toggle${mode === "current" ? " is-active" : ""}`}
              onClick={() => setMode("current")}
            >
              Current State
            </button>
            <button
              type="button"
              className={`admin-toggle${mode === "baseline" ? " is-active" : ""}`}
              onClick={() => setMode("baseline")}
            >
              Baseline
            </button>
          </div>
        </div>
        <div className="admin-toolbar-actions">
          <button type="button" onClick={saveDraft}>
            {mode === "baseline" ? "Save Baseline Draft" : "Apply to Game"}
          </button>
          {mode === "baseline" ? (
            <button type="button" onClick={exportBaseline}>
              Export Baseline JSON
            </button>
          ) : null}
          <button type="button" onClick={() => (window.location.hash = "#/game")}>
            Back to Game
          </button>
        </div>
      </div>
      {saveMessage ? <div className="meta">{saveMessage}</div> : null}

      <section className="admin-grid">
        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Missions</h2>
            <button type="button" onClick={addMission} disabled={!isBaseline}>
              Add
            </button>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              {state.data.missionPlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  className={`admin-list-item${
                    plan.id === selectedMissionId ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedMissionId(plan.id)}
                >
                  {plan.name}
                </button>
              ))}
            </div>
            <div className="admin-form">
              {selectedMission ? (
                <>
                  {!isBaseline ? (
                    <div className="meta">
                      Mission data edits are available in baseline mode.
                    </div>
                  ) : null}
                  {(() => {
                    const assignments = state.data.locationAssignments.filter(
                      (assignment) => assignment.planId === selectedMission.id,
                    );
                    const locationValue =
                      assignments[0]?.locationId ?? "none";
                    return (
                      <>
                        <label className="field">
                          Location assignment
                          <select
                            value={locationValue}
                            disabled={!isBaseline}
                            onChange={(event) =>
                              upsertMissionLocationAssignment(
                                selectedMission.id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="none">None (global)</option>
                            {state.data.locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {assignments.length > 1 ? (
                          <div className="meta">
                            Multiple assignments exist; this edits the first.
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedMission.name}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateMission(selectedMission.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Summary
                    <textarea
                      value={selectedMission.summary}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateMission(selectedMission.id, { summary: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Type
                    <input
                      type="text"
                      value={selectedMission.type}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateMission(selectedMission.id, { type: event.target.value as MissionType })
                      }
                    />
                  </label>
                  <div className="admin-row">
                    <label className="field">
                      Duration (hours)
                      <input
                        type="number"
                        min={1}
                        value={selectedMission.durationHours}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateMission(selectedMission.id, {
                            durationHours: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Success chance
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedMission.baseSuccessChance}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateMission(selectedMission.id, {
                            baseSuccessChance: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="field">
                    Required roles (comma)
                    <input
                      type="text"
                      value={selectedMission.requiredRoles.join(", ")}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateMission(selectedMission.id, {
                          requiredRoles: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean) as PersonnelRole[],
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Availability
                    <select
                      value={selectedMission.availability?.type ?? "none"}
                      disabled={!isBaseline}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "none") {
                          updateMission(selectedMission.id, { availability: undefined });
                          return;
                        }
                        if (value === "global") {
                          updateMission(selectedMission.id, {
                            availability: { type: "global" },
                          });
                          return;
                        }
                        updateMission(selectedMission.id, {
                          availability: {
                            type: "time",
                            startHours:
                              selectedMission.availability?.type === "time"
                                ? selectedMission.availability.startHours
                                : 0,
                            endHours:
                              selectedMission.availability?.type === "time"
                                ? selectedMission.availability.endHours
                                : 24,
                          },
                        });
                      }}
                    >
                      <option value="none">None</option>
                      <option value="global">Global</option>
                      <option value="time">Time window</option>
                    </select>
                  </label>
                  {selectedMission.availability?.type === "time" ? (
                    <div className="admin-row">
                      <label className="field">
                        Start hours
                        <input
                          type="number"
                          value={
                            selectedMission.availability.type === "time"
                              ? selectedMission.availability.startHours
                              : 0
                          }
                          disabled={!isBaseline}
                          onChange={(event) =>
                            updateMission(selectedMission.id, {
                              availability: {
                                type: "time",
                                startHours: Number(event.target.value),
                                endHours:
                                  selectedMission.availability?.type === "time"
                                    ? selectedMission.availability.endHours
                                    : 24,
                              },
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        End hours
                        <input
                          type="number"
                          value={
                            selectedMission.availability.type === "time"
                              ? selectedMission.availability.endHours
                              : 0
                          }
                          disabled={!isBaseline}
                          onChange={(event) =>
                            updateMission(selectedMission.id, {
                              availability: {
                                type: "time",
                                startHours:
                                  selectedMission.availability?.type === "time"
                                    ? selectedMission.availability.startHours
                                    : 0,
                                endHours: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                  <label className="field">
                    Required materials (JSON)
                    <textarea
                      value={JSON.stringify(selectedMission.requiredMaterials ?? [], null, 2)}
                      disabled={!isBaseline}
                      onChange={(event) => {
                        try {
                          const parsed = JSON.parse(event.target.value);
                          updateMission(selectedMission.id, { requiredMaterials: parsed });
                        } catch {
                          // ignore invalid JSON until it parses
                        }
                      }}
                    />
                  </label>
                  <label className="field">
                    Rewards (JSON)
                    <textarea
                      value={JSON.stringify(selectedMission.rewards ?? {}, null, 2)}
                      disabled={!isBaseline}
                      onChange={(event) => {
                        try {
                          const parsed = JSON.parse(event.target.value);
                          updateMission(selectedMission.id, { rewards: parsed });
                        } catch {
                          // ignore invalid JSON until it parses
                        }
                      }}
                    />
                  </label>
                  <label className="field">
                    Penalties (JSON)
                    <textarea
                      value={JSON.stringify(selectedMission.penalties ?? {}, null, 2)}
                      disabled={!isBaseline}
                      onChange={(event) => {
                        try {
                          const parsed = JSON.parse(event.target.value);
                          updateMission(selectedMission.id, { penalties: parsed });
                        } catch {
                          // ignore invalid JSON until it parses
                        }
                      }}
                    />
                  </label>
                </>
              ) : (
                <div className="meta">Select a mission to edit.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Locations</h2>
            <button type="button" onClick={addLocation} disabled={!isBaseline}>
              Add
            </button>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              {state.data.locations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  className={`admin-list-item${
                    location.id === selectedLocationId ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedLocationId(location.id)}
                >
                  {location.name}
                </button>
              ))}
            </div>
            <div className="admin-form">
              {selectedLocation ? (
                <>
                  {!isBaseline ? (
                    <div className="meta">
                      Location data edits are available in baseline mode.
                    </div>
                  ) : null}
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedLocation.name}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateLocation(selectedLocation.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Planet
                    <select
                      value={selectedLocation.planetId}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateLocation(selectedLocation.id, {
                          planetId: event.target.value,
                        })
                      }
                    >
                      {state.data.planets.map((planet) => (
                        <option key={planet.id} value={planet.id}>
                          {planet.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const planet = state.data.planets.find(
                      (p) => p.id === selectedLocation.planetId,
                    );
                    const sector = planet
                      ? state.data.sectors.find((s) => s.id === planet.sectorId)
                      : null;
                    return sector ? (
                      <div className="meta">Sector: {sector.name}</div>
                    ) : null;
                  })()}
                  <div className="admin-row">
                    <label className="field">
                      Resistance
                      <input
                        type="number"
                        value={selectedLocation.attributes.resistance}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              resistance: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Tech level
                      <input
                        type="number"
                        value={selectedLocation.attributes.techLevel}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              techLevel: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Population
                      <input
                        type="number"
                        value={selectedLocation.attributes.populationDensity}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              populationDensity: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="admin-row">
                    <label className="field">
                      Customs scrutiny
                      <input
                        type="number"
                        value={selectedLocation.attributes.customsScrutiny}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              customsScrutiny: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Patrol frequency
                      <input
                        type="number"
                        value={selectedLocation.attributes.patrolFrequency}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              patrolFrequency: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Garrison strength
                      <input
                        type="number"
                        value={selectedLocation.attributes.garrisonStrength}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              garrisonStrength: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Popular support
                      <input
                        type="number"
                        value={selectedLocation.attributes.popularSupport}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updateLocation(selectedLocation.id, {
                            attributes: {
                              ...selectedLocation.attributes,
                              popularSupport: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                </>
              ) : (
                <div className="meta">Select a location to edit.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Planets</h2>
            <button type="button" onClick={addPlanet} disabled={!isBaseline}>
              Add
            </button>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              {state.data.planets.map((planet) => (
                <button
                  key={planet.id}
                  type="button"
                  className={`admin-list-item${
                    planet.id === selectedPlanetId ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedPlanetId(planet.id)}
                >
                  {planet.name}
                </button>
              ))}
            </div>
            <div className="admin-form">
              {selectedPlanet ? (
                <>
                  {!isBaseline ? (
                    <div className="meta">
                      Planet data edits are available in baseline mode.
                    </div>
                  ) : null}
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedPlanet.name}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updatePlanet(selectedPlanet.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Sector
                    <select
                      value={selectedPlanet.sectorId}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updatePlanet(selectedPlanet.id, {
                          sectorId: event.target.value,
                        })
                      }
                    >
                      {state.data.sectors.map((sector) => (
                        <option key={sector.id} value={sector.id}>
                          {sector.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Tags (comma)
                    <input
                      type="text"
                      value={(selectedPlanet.tags ?? []).join(", ")}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updatePlanet(selectedPlanet.id, {
                          tags: event.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <div className="admin-row">
                    <label className="field">
                      Position X
                      <input
                        type="number"
                        value={selectedPlanet.position.x}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updatePlanet(selectedPlanet.id, {
                            position: {
                              ...selectedPlanet.position,
                              x: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Position Y
                      <input
                        type="number"
                        value={selectedPlanet.position.y}
                        disabled={!isBaseline}
                        onChange={(event) =>
                          updatePlanet(selectedPlanet.id, {
                            position: {
                              ...selectedPlanet.position,
                              y: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                </>
              ) : (
                <div className="meta">Select a planet to edit.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Sectors</h2>
            <button type="button" onClick={addSector} disabled={!isBaseline}>
              Add
            </button>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              {state.data.sectors.map((sector) => (
                <button
                  key={sector.id}
                  type="button"
                  className={`admin-list-item${
                    sector.id === selectedSectorId ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedSectorId(sector.id)}
                >
                  {sector.name}
                </button>
              ))}
            </div>
            <div className="admin-form">
              {selectedSector ? (
                <>
                  {!isBaseline ? (
                    <div className="meta">
                      Sector data edits are available in baseline mode.
                    </div>
                  ) : null}
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedSector.name}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateSector(selectedSector.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Tags (comma)
                    <input
                      type="text"
                      value={(selectedSector.tags ?? []).join(", ")}
                      disabled={!isBaseline}
                      onChange={(event) =>
                        updateSector(selectedSector.id, {
                          tags: event.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Polygon (JSON)
                    <textarea
                      value={JSON.stringify(selectedSector.polygon ?? [], null, 2)}
                      disabled={!isBaseline}
                      onChange={(event) => {
                        try {
                          const parsed = JSON.parse(event.target.value);
                          updateSector(selectedSector.id, { polygon: parsed });
                        } catch {
                          // ignore invalid JSON
                        }
                      }}
                    />
                  </label>
                </>
              ) : (
                <div className="meta">Select a sector to edit.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Role definitions</h2>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              {((balance as { personnelRoles?: string[] }).personnelRoles ?? []).map(
                (roleId) => (
                  <button
                    key={roleId}
                    type="button"
                    className={`admin-list-item${
                      roleId === selectedRoleDefinitionId ? " is-active" : ""
                    }`}
                    onClick={() => setSelectedRoleDefinitionId(roleId)}
                  >
                    {roleId}
                  </button>
                ),
              )}
            </div>
            <div className="admin-form">
              {selectedRoleDefinitionId ? (
                <div className="meta">
                  <div>
                    <strong>{selectedRoleDefinitionId}</strong>
                  </div>
                  <div className="meta">
                    Success:{" "}
                    {(balance as { roleSuccessModifiers?: Record<string, number> })
                      .roleSuccessModifiers?.[selectedRoleDefinitionId] ?? "—"}
                  </div>
                  <div className="meta">
                    Reward:{" "}
                    {(balance as { roleRewardModifiers?: Record<string, number> })
                      .roleRewardModifiers?.[selectedRoleDefinitionId] ?? "—"}
                  </div>
                  <div className="meta">
                    Consume:{" "}
                    {(balance as { roleConsumeModifiers?: Record<string, number> })
                      .roleConsumeModifiers?.[selectedRoleDefinitionId] ?? "—"}
                  </div>
                </div>
              ) : (
                <div className="meta">Select a role to view modifiers.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Trait definitions</h2>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              <button
                type="button"
                className={`admin-list-item${
                  traitDefinitionTab === "immutable" ? " is-active" : ""
                }`}
                onClick={() => setTraitDefinitionTab("immutable")}
              >
                Immutable
              </button>
              <button
                type="button"
                className={`admin-list-item${
                  traitDefinitionTab === "mutable" ? " is-active" : ""
                }`}
                onClick={() => setTraitDefinitionTab("mutable")}
              >
                Mutable
              </button>
              <button
                type="button"
                className={`admin-list-item${
                  traitDefinitionTab === "class" ? " is-active" : ""
                }`}
                onClick={() => setTraitDefinitionTab("class")}
              >
                Class
              </button>
            </div>
            <div className="admin-form">
              {(() => {
                const bal = balance as {
                  immutableTraits?: string[];
                  mutableTraits?: string[];
                  traitClass?: string[];
                  traitSuccessModifiers?: Record<string, number>;
                };
                const list =
                  traitDefinitionTab === "immutable"
                    ? bal.immutableTraits ?? []
                    : traitDefinitionTab === "mutable"
                      ? bal.mutableTraits ?? []
                      : bal.traitClass ?? [];
                const mods = bal.traitSuccessModifiers ?? {};
                return (
                  <>
                    <div className="meta">
                      {list.length === 0
                        ? "No traits"
                        : list.join(", ")}
                    </div>
                    <div className="meta" style={{ marginTop: 8 }}>
                      <strong>Success modifiers</strong>
                    </div>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                      {list.map((traitId) => (
                        <li key={traitId} className="meta">
                          {traitId}: {mods[traitId] ?? "—"}
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="card admin-panel">
          <div className="admin-section-header">
            <h2>Agents</h2>
            <button type="button" onClick={addPersonnel}>
              Add
            </button>
          </div>
          <div className="admin-layout">
            <div className="admin-list">
              {state.runtime.personnel.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className={`admin-list-item${
                    person.id === selectedPersonnelId ? " is-active" : ""
                  }`}
                  onClick={() => setSelectedPersonnelId(person.id)}
                >
                  {person.name}
                </button>
              ))}
            </div>
            <div className="admin-form">
              {selectedPersonnel ? (
                <>
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedPersonnel.name}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Roles (comma)
                    <input
                      type="text"
                      value={selectedPersonnel.roles.join(", ")}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, {
                          roles: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean) as PersonnelRole[],
                        })
                      }
                    />
                  </label>
                  {selectedPersonnel.roles.length > 0 ? (
                    <label className="field">
                      Role levels
                      <div className="admin-row" style={{ flexWrap: "wrap", gap: 8 }}>
                        {selectedPersonnel.roles.map((roleId) => {
                          const maxLevel = (balance as { maxRoleLevel?: number }).maxRoleLevel ?? 10;
                          const level = selectedPersonnel.roleLevels?.[roleId as PersonnelRole] ?? 1;
                          return (
                            <span key={roleId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span className="meta">{roleId}:</span>
                              <select
                                value={level}
                                onChange={(event) =>
                                  updatePersonnel(selectedPersonnel.id, {
                                    roleLevels: {
                                      ...selectedPersonnel.roleLevels,
                                      [roleId]: Number(event.target.value),
                                    },
                                  })
                                }
                              >
                                {Array.from({ length: maxLevel }, (_, i) => i + 1).map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            </span>
                          );
                        })}
                      </div>
                    </label>
                  ) : null}
                  <label className="field">
                    Traits (comma)
                    <input
                      type="text"
                      value={getTraitsForPerson(selectedPersonnel).join(", ")}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, {
                          traits: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                          immutableTraits: undefined,
                          mutableTraits: undefined,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Status
                    <select
                      value={selectedPersonnel.status}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, {
                          status: event.target.value as Personnel["status"],
                        })
                      }
                    >
                      <option value="idle">idle</option>
                      <option value="assigned">assigned</option>
                      <option value="traveling">traveling</option>
                      <option value="wounded">wounded</option>
                    </select>
                  </label>
                  <label className="field">
                    Location
                    <select
                      value={selectedPersonnel.locationId}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, {
                          locationId: event.target.value,
                        })
                      }
                    >
                      {state.data.locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <div className="meta">Select an agent to edit.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
