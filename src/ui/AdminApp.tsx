import { useMemo, useState } from "react";
import type { GameState, MissionPlan, Personnel, Location } from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";
import { refreshMissionOffers } from "../engine.js";
import { parseSave, serializeSave } from "../persistence.js";

const ADMIN_DRAFT_KEY = "uprise-admin-draft";

const loadInitialState = (): GameState => {
  const raw = localStorage.getItem(ADMIN_DRAFT_KEY);
  if (raw) {
    const parsed = parseSave(raw);
    if (parsed) {
      return parsed;
    }
  }
  const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
  const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
  return refreshMissionOffers(scenario);
};

export const AdminApp = () => {
  const [state, setState] = useState<GameState>(() => loadInitialState());
  const [selectedMissionId, setSelectedMissionId] = useState<string>(
    state.missionPlans[0]?.id ?? "",
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    state.locations[0]?.id ?? "",
  );
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>(
    state.personnel[0]?.id ?? "",
  );
  const [saveMessage, setSaveMessage] = useState<string>("");

  const selectedMission = useMemo(
    () => state.missionPlans.find((plan) => plan.id === selectedMissionId) ?? null,
    [state.missionPlans, selectedMissionId],
  );
  const selectedLocation = useMemo(
    () => state.locations.find((item) => item.id === selectedLocationId) ?? null,
    [state.locations, selectedLocationId],
  );
  const selectedPersonnel = useMemo(
    () => state.personnel.find((item) => item.id === selectedPersonnelId) ?? null,
    [state.personnel, selectedPersonnelId],
  );

  const updateMission = (planId: string, patch: Partial<MissionPlan>) => {
    setState((prev) => ({
      ...prev,
      missionPlans: prev.missionPlans.map((plan) =>
        plan.id === planId ? { ...plan, ...patch } : plan,
      ),
    }));
  };
  const updateLocation = (locationId: string, patch: Partial<Location>) => {
    setState((prev) => ({
      ...prev,
      locations: prev.locations.map((location) =>
        location.id === locationId ? { ...location, ...patch } : location,
      ),
    }));
  };
  const updatePersonnel = (personnelId: string, patch: Partial<Personnel>) => {
    setState((prev) => ({
      ...prev,
      personnel: prev.personnel.map((person) =>
        person.id === personnelId ? { ...person, ...patch } : person,
      ),
    }));
  };

  const saveDraft = () => {
    localStorage.setItem(ADMIN_DRAFT_KEY, serializeSave(state));
    setSaveMessage("Draft saved.");
    window.setTimeout(() => setSaveMessage(""), 1500);
  };

  return (
    <div className="page admin-page">
      <div className="admin-toolbar">
        <div>
          <h1>Admin Editor</h1>
          <div className="meta">Edit missions, locations, and agents.</div>
        </div>
        <div className="admin-toolbar-actions">
          <button type="button" onClick={saveDraft}>
            Save Draft
          </button>
          <button type="button" onClick={() => (window.location.hash = "#/game")}>
            Back to Game
          </button>
        </div>
      </div>
      {saveMessage ? <div className="meta">{saveMessage}</div> : null}

      <section className="admin-grid">
        <div className="card admin-panel">
          <h2>Missions</h2>
          <div className="admin-layout">
            <div className="admin-list">
              {state.missionPlans.map((plan) => (
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
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedMission.name}
                      onChange={(event) =>
                        updateMission(selectedMission.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Summary
                    <textarea
                      value={selectedMission.summary}
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
                      onChange={(event) =>
                        updateMission(selectedMission.id, { type: event.target.value })
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
                        onChange={(event) =>
                          updateMission(selectedMission.id, {
                            baseSuccessChance: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="field">
                    Required skills (comma)
                    <input
                      type="text"
                      value={selectedMission.requiredSkills.join(", ")}
                      onChange={(event) =>
                        updateMission(selectedMission.id, {
                          requiredSkills: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Availability
                    <select
                      value={selectedMission.availability?.type ?? "none"}
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
                          value={selectedMission.availability.startHours}
                          onChange={(event) =>
                            updateMission(selectedMission.id, {
                              availability: {
                                type: "time",
                                startHours: Number(event.target.value),
                                endHours: selectedMission.availability?.endHours ?? 24,
                              },
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        End hours
                        <input
                          type="number"
                          value={selectedMission.availability.endHours}
                          onChange={(event) =>
                            updateMission(selectedMission.id, {
                              availability: {
                                type: "time",
                                startHours: selectedMission.availability?.startHours ?? 0,
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
          <h2>Locations</h2>
          <div className="admin-layout">
            <div className="admin-list">
              {state.locations.map((location) => (
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
                  <label className="field">
                    Name
                    <input
                      type="text"
                      value={selectedLocation.name}
                      onChange={(event) =>
                        updateLocation(selectedLocation.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Planet
                    <select
                      value={selectedLocation.planetId}
                      onChange={(event) =>
                        updateLocation(selectedLocation.id, {
                          planetId: event.target.value,
                        })
                      }
                    >
                      {state.planets.map((planet) => (
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
          <h2>Agents</h2>
          <div className="admin-layout">
            <div className="admin-list">
              {state.personnel.map((person) => (
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
                      value={selectedPersonnel.skills.join(", ")}
                      onChange={(event) =>
                        updatePersonnel(selectedPersonnel.id, {
                          skills: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
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
                      {state.locations.map((location) => (
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
