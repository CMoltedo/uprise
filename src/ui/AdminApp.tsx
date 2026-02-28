import { useEffect, useMemo, useState } from "react";
import type {
  GameState,
  MissionPlan,
  MissionType,
  Personnel,
  PersonnelRole,
  Location,
  LocationAssignment,
} from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";
import { refreshMissionOffers } from "../engine.js";
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
  const [saveMessage, setSaveMessage] = useState<string>("");
  const isBaseline = mode === "baseline";

  useEffect(() => {
    const nextState = loadInitialState(mode);
    setState(nextState);
    setSelectedMissionId(nextState.data.missionPlans[0]?.id ?? "");
    setSelectedLocationId(nextState.data.locations[0]?.id ?? "");
    setSelectedPersonnelId(nextState.runtime.personnel[0]?.id ?? "");
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

  const addPersonnel = () => {
    const id = `custom-personnel-${Date.now()}`;
    const locationId = state.data.locations[0]?.id ?? "";
    const person: Personnel = {
      id,
      name: "New Agent",
      roles: [],
      traits: [],
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
                    Skills (comma)
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
                  <label className="field">
                    Traits (comma)
                    <input
                      type="text"
                      value={selectedPersonnel.traits?.join(", ") ?? ""}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, {
                          traits: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
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
