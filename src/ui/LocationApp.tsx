import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  advanceTime,
  assignPersonnelToMission,
  assignTravel,
  getMaterialRewardModifier,
  refreshMissionOffers,
  validateAssignment,
} from "../engine.js";
import type { GameState, Personnel } from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import {
  SPEEDS,
  createHourAccumulator,
  formatInUniverseTime,
  getHourOfDay,
  getUniverseDate,
} from "../time.js";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";
import { SAVE_KEY, parseSave, serializeSave } from "../persistence.js";

const formatResources = (state: GameState) =>
  `Cr ${state.resources.credits} · Intel ${state.resources.intel}`;

export const LocationApp = () => {
  const initialScenario = (() => {
    const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
    const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
    return refreshMissionOffers(scenario);
  })();

  const [state, setState] = useState<GameState>(() => initialScenario);
  const [speedIndex, setSpeedIndex] = useState<number>(2);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    initialScenario.locations[0]?.id ?? "",
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    initialScenario.missionPlans[0]?.id ?? "",
  );
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>("");
  const [travelPersonnelId, setTravelPersonnelId] = useState<string>(
    initialScenario.personnel[0]?.id ?? "",
  );
  const [travelDestinationId, setTravelDestinationId] = useState<string>(
    initialScenario.locations[0]?.id ?? "",
  );
  const [travelHours, setTravelHours] = useState<number>(12);
  const [dragPlanId, setDragPlanId] = useState<string | null>(null);

  const locationById = useMemo(
    () => new Map(state.locations.map((location) => [location.id, location])),
    [state.locations],
  );
  const sectorById = useMemo(
    () => new Map(state.sectors.map((sector) => [sector.id, sector])),
    [state.sectors],
  );
  const planetById = useMemo(
    () => new Map(state.planets.map((planet) => [planet.id, planet])),
    [state.planets],
  );
  const planById = useMemo(
    () => new Map(state.missionPlans.map((plan) => [plan.id, plan])),
    [state.missionPlans],
  );
  const personnelById = useMemo(
    () => new Map(state.personnel.map((person) => [person.id, person])),
    [state.personnel],
  );
  const materialRewardTableById = useMemo(
    () =>
      new Map(state.materialRewardTables.map((table) => [table.id, table])),
    [state.materialRewardTables],
  );
  const missionTypeConfigByType = useMemo(
    () => new Map(state.missionTypeConfigs.map((config) => [config.type, config])),
    [state.missionTypeConfigs],
  );

  const selectedLocation = useMemo(
    () => locationById.get(selectedLocationId) ?? null,
    [locationById, selectedLocationId],
  );
  const locationPersonnel = useMemo(
    () =>
      state.personnel.filter((person) => person.locationId === selectedLocationId),
    [state.personnel, selectedLocationId],
  );
  const selectedPersonnel = useMemo(() => {
    if (!selectedPersonnelId) {
      return null;
    }
    return (
      state.personnel.find((person) => person.id === selectedPersonnelId) ?? null
    );
  }, [selectedPersonnelId, state.personnel]);

  const availableOffers = useMemo(
    () => state.missionOffers.filter((offer) => offer.locationId === selectedLocationId),
    [state.missionOffers, selectedLocationId],
  );
  const offerHoursByPlanId = useMemo(() => {
    const map = new Map<string, number>();
    for (const offer of availableOffers) {
      const hoursLeft = Math.max(0, offer.expiresAtHours - state.nowHours);
      map.set(offer.planId, hoursLeft);
    }
    return map;
  }, [availableOffers, state.nowHours]);
  const availablePlans = useMemo(() => {
    const plansFromOffers = availableOffers
      .map((offer) => state.missionPlans.find((plan) => plan.id === offer.planId))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

    const globalPlans = state.missionPlans.filter(
      (plan) => plan.availability?.type === "global",
    );
    const timePlans = state.missionPlans.filter(
      (plan) =>
        plan.availability?.type === "time" &&
        state.nowHours >= plan.availability.startHours &&
        state.nowHours <= plan.availability.endHours,
    );
    return [...plansFromOffers, ...globalPlans, ...timePlans];
  }, [availableOffers, state.missionPlans, state.nowHours]);

  const selectedPlan = useMemo(
    () => state.missionPlans.find((plan) => plan.id === selectedPlanId),
    [state.missionPlans, selectedPlanId],
  );
  const selectedOffer = useMemo(
    () =>
      availableOffers.find((offer) => offer.planId === selectedPlanId) ?? null,
    [availableOffers, selectedPlanId],
  );
  const assignmentErrors = useMemo(() => {
    if (!selectedPlan) {
      return ["Select an assignment."];
    }
    if (!selectedPersonnel) {
      return ["Select personnel."];
    }
    return validateAssignment(state, selectedPlan, [selectedPersonnel]);
  }, [selectedPlan, selectedPersonnel, state]);
  const activeMissions = useMemo(
    () =>
      state.missions.filter(
        (mission) =>
          mission.status === "active" && mission.locationId === selectedLocationId,
      ),
    [state.missions, selectedLocationId],
  );

  const rewardModifier = useMemo(
    () =>
      selectedLocation ? getMaterialRewardModifier(state, selectedLocation.id) : null,
    [selectedLocation, state],
  );
  const missionListRows = Math.max(4, availablePlans.length);

  const timeAccumulatorRef = useRef(
    createHourAccumulator(SPEEDS[2], initialScenario.nowHours),
  );
  const [toasts, setToasts] = useState<
    Array<{ id: string; message: string }>
  >([]);
  const lastEventIdRef = useRef<string | null>(null);

  const nowDate = getUniverseDate(state.nowHours);
  const year = nowDate.getUTCFullYear();
  const month = nowDate.getUTCMonth() + 1;
  const day = nowDate.getUTCDate();
  const hourOfDay = getHourOfDay(state.nowHours);
  const hourFill = (hourOfDay / 24) * 100;
  const [yearFlashKey, setYearFlashKey] = useState(0);
  const [monthFlashKey, setMonthFlashKey] = useState(0);
  const [dayFlashKey, setDayFlashKey] = useState(0);
  const [dialFlashKey, setDialFlashKey] = useState(0);
  const lastDateRef = useRef<{
    year: number;
    month: number;
    day: number;
    hour: number;
  } | null>(null);

  const pushToast = (message: string) => {
    const id = `toast-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setToasts((prev) => [...prev, { id, message }]);
  };

  const handleSave = () => {
    const payload = serializeSave(state);
    localStorage.setItem(SAVE_KEY, payload);
    pushToast("Game saved locally.");
  };

  const handleLoad = () => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      pushToast("No local save found.");
      return;
    }
    const loaded = parseSave(raw);
    if (!loaded) {
      pushToast("Save file is invalid.");
      return;
    }
    setState(loaded);
    setSelectedLocationId(loaded.locations[0]?.id ?? "");
    setSelectedPlanId(loaded.missionPlans[0]?.id ?? "");
    setSelectedPersonnelId("");
    setTravelPersonnelId(loaded.personnel[0]?.id ?? "");
    setTravelDestinationId(loaded.locations[0]?.id ?? "");
    pushToast("Game loaded from local save.");
  };

  const handleAssign = () => {
    try {
      if (!selectedPlanId) {
        alert("Select a mission first.");
        return;
      }
      if (!selectedPersonnelId) {
        alert("Select personnel.");
        return;
      }
      const next = assignPersonnelToMission(
        state,
        selectedPlanId,
        [selectedPersonnelId],
      );
      setState(next);
      setSelectedPersonnelId("");
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Assignment failed");
    }
  };

  const handleAssignTravel = () => {
    try {
      if (!travelPersonnelId || !travelDestinationId) {
        alert("Select personnel and destination.");
        return;
      }
      const next = assignTravel(
        state,
        travelPersonnelId,
        travelDestinationId,
        travelHours,
      );
      setState(next);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Travel assignment failed");
    }
  };

  const handleDragStart =
    (personId: string) => (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData("text/plain", personId);
      event.dataTransfer.effectAllowed = "move";
    };

  const handleDropOnPlan =
    (planId: string) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragPlanId(null);
      const personId = event.dataTransfer.getData("text/plain");
      if (!personId) {
        return;
      }
      const person = personnelById.get(personId);
      const plan = planById.get(planId);
      if (!person || !plan) {
        return;
      }
      const errors = validateAssignment(state, plan, [person]);
      if (errors.length > 0) {
        pushToast(errors[0]);
        setSelectedPlanId(planId);
        setSelectedPersonnelId(personId);
        return;
      }
      const next = assignPersonnelToMission(state, planId, [personId]);
      setState(next);
      setSelectedPlanId(planId);
      setSelectedPersonnelId("");
    };

  const getPlanHoursLeftLabel = (plan: typeof availablePlans[number]) => {
    const offerHours = offerHoursByPlanId.get(plan.id);
    if (offerHours !== undefined) {
      return `(${Math.ceil(offerHours)}h)`;
    }
    if (plan.availability?.type === "time") {
      const hoursLeft = Math.max(0, plan.availability.endHours - state.nowHours);
      return `(${Math.ceil(hoursLeft)}h)`;
    }
    if (plan.availability?.type === "global") {
      return "(∞h)";
    }
    return "(?h)";
  };

  const getPersonnelOptionStyle = (person: Personnel) => {
    const isUnavailable =
      person.status === "wounded" ||
      person.status === "assigned" ||
      person.status === "traveling";
    return isUnavailable ? { color: "#6b7280" } : undefined;
  };

  const getLocationLabel = (locationId: string) => {
    const location = locationById.get(locationId);
    if (!location) {
      return locationId;
    }
    const planet = planetById.get(location.planetId);
    const sector = planet ? sectorById.get(planet.sectorId) : null;
    return `${sector?.name ?? planet?.sectorId ?? "unknown sector"} · ${
      planet?.name ?? location.planetId
    } · ${location.name}`;
  };

  useEffect(() => {
    const speed = SPEEDS[speedIndex] ?? SPEEDS[2];
    setState((prev) => {
      timeAccumulatorRef.current.setSpeed(speed, prev.nowHours);
      return prev;
    });
    const interval = setInterval(() => {
      setState((prev) => {
        const hoursToAdvance = timeAccumulatorRef.current.tick(prev.nowHours);
        return hoursToAdvance > 0 ? advanceTime(prev, hoursToAdvance) : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [speedIndex]);

  useEffect(() => {
    const latest = state.eventLog[state.eventLog.length - 1];
    if (!latest || latest.id === lastEventIdRef.current) {
      return;
    }
    lastEventIdRef.current = latest.id;
    const message =
      latest.kind === "mission"
        ? `${latest.success ? "Successful" : "Failed"} mission by ${
            latest.personnelIds
              .map((id) => personnelById.get(id)?.name ?? id)
              .join(", ")
          } at ${getLocationLabel(latest.locationId)}`
        : latest.status === "started"
          ? `${personnelById.get(latest.personnelId)?.name ?? latest.personnelId} departed ${
              getLocationLabel(latest.fromLocationId)
            } for ${getLocationLabel(latest.toLocationId)} (${latest.travelHours ?? 0}h)`
          : `${personnelById.get(latest.personnelId)?.name ?? latest.personnelId} arrived at ${
              getLocationLabel(latest.toLocationId)
            } from ${getLocationLabel(latest.fromLocationId)}`;
    const toast = { id: latest.id, message };
    setToasts((prev) => [...prev, toast]);
  }, [state.eventLog, personnelById, locationById, planetById, sectorById]);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!availablePlans.find((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(availablePlans[0]?.id ?? "");
    }
  }, [availablePlans, selectedPlanId]);

  useEffect(() => {
    const current = { year, month, day, hour: hourOfDay };
    const previous = lastDateRef.current;
    if (previous) {
      if (previous.year !== year) {
        setYearFlashKey((prev) => prev + 1);
      }
      if (previous.month !== month) {
        setMonthFlashKey((prev) => prev + 1);
      }
      if (previous.day !== day) {
        setDayFlashKey((prev) => prev + 1);
      }
      if (previous.hour !== hourOfDay && hourOfDay === 0) {
        setDialFlashKey((prev) => prev + 1);
      }
    }
    lastDateRef.current = current;
  }, [year, month, day, hourOfDay]);

  useEffect(() => {
    if (locationPersonnel.find((person) => person.id === selectedPersonnelId)) {
      return;
    }
    setSelectedPersonnelId(locationPersonnel[0]?.id ?? "");
  }, [locationPersonnel, selectedPersonnelId]);

  useEffect(() => {
    if (locationById.has(selectedLocationId)) {
      return;
    }
    setSelectedLocationId(state.locations[0]?.id ?? "");
  }, [locationById, selectedLocationId, state.locations]);

  return (
    <div className="page">
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() =>
                setToasts((prev) => prev.filter((item) => item.id !== toast.id))
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <header className="header">
        <div>
          <h1>Uprise</h1>
          <p>Faction: {state.faction}</p>
        </div>
        <div className="resources">
          <div>{formatResources(state)}</div>
          <div className="time-indicator">
            <div className="date-indicator">
              <div className="date-year">
                <span className="date-icon">🗓️</span>
                <span key={yearFlashKey} className="flash-text">
                  {year}
                </span>
              </div>
              <div className="date-md">
                <span key={monthFlashKey} className="flash-text">
                  {month.toString().padStart(2, "0")}
                </span>
                -
                <span key={dayFlashKey} className="flash-text">
                  {day.toString().padStart(2, "0")}
                </span>
              </div>
              <div className="date-md">{formatInUniverseTime(state.nowHours)}</div>
            </div>
            <div key={dialFlashKey} className="time-dial-wrap">
              <div
                className="time-dial"
                style={{ ["--dial-fill" as string]: `${hourFill}%` }}
              >
                <div className="time-dial-center" />
                <div className="time-dial-label">{hourOfDay}h</div>
              </div>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={() => setSpeedIndex((prev) => Math.max(0, prev - 1))}
            >
              Slower
            </button>
            <button
              type="button"
              onClick={() =>
                setSpeedIndex((prev) => Math.min(SPEEDS.length - 1, prev + 1))
              }
            >
              Faster
            </button>
            <button type="button" onClick={handleSave}>
              Save
            </button>
            <button type="button" onClick={handleLoad}>
              Load
            </button>
          </div>
          <div className="meta">Speed: {SPEEDS[speedIndex]?.label}</div>
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>Location Focus</h2>
          <label className="field">
            Location
            <select
              value={selectedLocationId}
              onChange={(event) => setSelectedLocationId(event.target.value)}
              size={Math.max(4, Math.min(8, state.locations.length))}
              style={{
                height: `${Math.max(4, Math.min(8, state.locations.length)) * 2.1}rem`,
              }}
            >
              {state.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {getLocationLabel(location.id)}
                </option>
              ))}
            </select>
          </label>
          {selectedLocation ? (
            <div className="meta">
              {getLocationLabel(selectedLocation.id)}
              <div className="meta">
                Resistance {selectedLocation.attributes.resistance} · Tech{" "}
                {selectedLocation.attributes.techLevel} · Population{" "}
                {selectedLocation.attributes.populationDensity}
              </div>
              <div className="meta">
                Customs {selectedLocation.attributes.customsScrutiny} · Patrols{" "}
                {selectedLocation.attributes.patrolFrequency} · Garrison{" "}
                {selectedLocation.attributes.garrisonStrength}
              </div>
            </div>
          ) : (
            <div className="meta">Select a location to see details.</div>
          )}
          <div className="meta">Personnel here: {locationPersonnel.length}</div>
          {locationPersonnel.length === 0 ? (
            <p>No personnel at this location.</p>
          ) : (
            <div className="personnel-cards">
              {locationPersonnel.map((person) => (
                <div
                  key={person.id}
                  className={`personnel-card${
                    person.status === "wounded" ||
                    person.status === "assigned" ||
                    person.status === "traveling"
                      ? " is-unavailable"
                      : ""
                  }`}
                  style={getPersonnelOptionStyle(person)}
                  draggable
                  onDragStart={handleDragStart(person.id)}
                >
                  <strong>{person.name}</strong>
                  <div className="meta">
                    {person.skills.join(", ")} · {person.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Assignment Planning</h2>
          <div className="meta">
            Assignments at {getLocationLabel(selectedLocationId)}
          </div>
          <label className="field">
            Personnel
            <select
              value={selectedPersonnelId}
              onChange={(event) => setSelectedPersonnelId(event.target.value)}
              size={Math.max(4, Math.min(8, locationPersonnel.length))}
              style={{
                height: `${Math.max(4, Math.min(8, locationPersonnel.length || 4)) * 2.1}rem`,
              }}
            >
              <option value="">-- choose --</option>
              {locationPersonnel.map((person) => (
                <option
                  key={person.id}
                  value={person.id}
                  style={getPersonnelOptionStyle(person)}
                >
                  {person.name} · {person.skills.join(", ")} · {person.status}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Assignment
            <select
              value={selectedPlanId}
              onChange={(event) => setSelectedPlanId(event.target.value)}
              size={missionListRows}
              style={{ height: `${missionListRows * 2.1}rem` }}
            >
              {availablePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {getPlanHoursLeftLabel(plan)} {plan.name} — {plan.summary}
                </option>
              ))}
            </select>
          </label>
          <div className="meta">Drag a personnel card onto a mission to assign.</div>
          <div className="mission-drop-list">
            {availablePlans.map((plan) => (
              <div
                key={plan.id}
                className={`mission-drop${dragPlanId === plan.id ? " is-over" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragPlanId(plan.id);
                }}
                onDragLeave={() => setDragPlanId(null)}
                onDrop={handleDropOnPlan(plan.id)}
              >
                <strong>{plan.name}</strong>
                <div className="meta">{plan.summary}</div>
                <div className="meta">
                  {getPlanHoursLeftLabel(plan)} · {plan.durationHours}h · Success{" "}
                  {Math.round(plan.baseSuccessChance * 100)}%
                </div>
              </div>
            ))}
          </div>
          {selectedPlan ? (
            <div className="meta">
              {selectedPlan.name} · {selectedPlan.type}
              <div className="meta">
                Duration {selectedPlan.durationHours}h · Success{" "}
                {Math.round(selectedPlan.baseSuccessChance * 100)}%
              </div>
              {selectedOffer ? (
                <div className="meta">
                  Offer expires {formatInUniverseTime(selectedOffer.expiresAtHours)}
                </div>
              ) : selectedPlan.availability?.type === "global" ? (
                <div className="meta">Global availability</div>
              ) : selectedPlan.availability?.type === "time" ? (
                <div className="meta">
                  Window {formatInUniverseTime(selectedPlan.availability.startHours)}{" "}
                  to {formatInUniverseTime(selectedPlan.availability.endHours)}
                </div>
              ) : null}
              <div className="meta">
                Skills: {selectedPlan.requiredSkills.join(", ")}
              </div>
              {selectedPlan.requiredMaterials &&
              selectedPlan.requiredMaterials.length > 0 ? (
                <div className="meta">
                  Materials:{" "}
                  {selectedPlan.requiredMaterials
                    .map(
                      (req) =>
                        `${req.quantity}x ${req.materialId} (${Math.round(
                          req.consumeChance * 100,
                        )}% consume)`,
                    )
                    .join(", ")}
                </div>
              ) : null}
              {selectedPlan.materialRewardTableId ||
              missionTypeConfigByType.get(selectedPlan.type)
                ?.defaultMaterialRewardTableId ? (
                <div className="meta">
                  Materials:{" "}
                  {materialRewardTableById
                    .get(
                      selectedPlan.materialRewardTableId ??
                        missionTypeConfigByType.get(selectedPlan.type)
                          ?.defaultMaterialRewardTableId ??
                        "",
                    )
                    ?.entries.map((entry) => {
                      const chance = rewardModifier
                        ? Math.round(entry.baseChance * rewardModifier * 100)
                        : Math.round(entry.baseChance * 100);
                      return `${entry.quantity}x ${entry.materialId} (${chance}%)`;
                    })
                    .join(", ") || "none"}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="meta">Select an assignment to see details.</div>
          )}
          <div className="actions">
            <button
              type="button"
              onClick={handleAssign}
              disabled={assignmentErrors.length > 0}
              title={
                assignmentErrors.length > 0
                  ? assignmentErrors.join(" ")
                  : "Assign personnel to this assignment."
              }
            >
              Assign
            </button>
            {assignmentErrors.length > 0 ? (
              <span className="meta" style={{ color: "#f87171" }}>
                {assignmentErrors[0]}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Active Assignments</h2>
          {activeMissions.length === 0 ? (
            <p>No active assignments at this location.</p>
          ) : (
            <ul>
              {activeMissions.map((mission) => (
                <li key={mission.id}>
                  {planById.get(mission.planId)?.name ?? mission.planId} ·{" "}
                  {getLocationLabel(mission.locationId)} ·{" "}
                  {mission.remainingHours}h remaining · pers{" "}
                  {mission.assignedPersonnelIds
                    .map((id) => personnelById.get(id)?.name ?? id)
                    .join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Travel Orders</h2>
          <label className="field">
            Personnel
            <select
              value={travelPersonnelId}
              onChange={(event) => setTravelPersonnelId(event.target.value)}
            >
              {state.personnel.map((person) => (
                <option
                  key={person.id}
                  value={person.id}
                  style={getPersonnelOptionStyle(person)}
                >
                  {person.name} · {person.skills.join(", ")} ·{" "}
                  {person.traits?.join(", ") ?? "no traits"} · {person.status} ·{" "}
                  {getLocationLabel(person.locationId)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Destination
            <select
              value={travelDestinationId}
              onChange={(event) => setTravelDestinationId(event.target.value)}
            >
              {state.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {getLocationLabel(location.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Travel time (hours)
            <input
              type="number"
              min={1}
              value={travelHours}
              onChange={(event) => setTravelHours(Number(event.target.value))}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={handleAssignTravel}>
              Assign travel
            </button>
          </div>
          {state.travel.length > 0 ? (
            <ul>
              {state.travel.map((assignment) => (
                <li key={assignment.id}>
                  {personnelById.get(assignment.personnelId)?.name ??
                    assignment.personnelId}{" "}
                  · {getLocationLabel(assignment.fromLocationId)} →{" "}
                  {getLocationLabel(assignment.toLocationId)} ·{" "}
                  {assignment.remainingHours}h remaining
                </li>
              ))}
            </ul>
          ) : (
            <p>No active travel.</p>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Materials</h2>
        <ul>
          {state.materials.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong> · qty {item.quantity}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Event Log</h2>
        {state.eventLog.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          <ul>
            {state.eventLog
              .slice()
              .reverse()
              .map((event) => (
                <li key={event.id}>
                  {event.kind === "mission"
                    ? `${event.success ? "Successful" : "Failed"} mission by ${
                        event.personnelIds
                          .map((id) => personnelById.get(id)?.name ?? id)
                          .join(", ")
                      } at ${getLocationLabel(event.locationId)}`
                    : event.status === "started"
                      ? `${personnelById.get(event.personnelId)?.name ?? event.personnelId} departed ${
                          getLocationLabel(event.fromLocationId)
                        } for ${getLocationLabel(event.toLocationId)} (${event.travelHours ?? 0}h)`
                      : `${personnelById.get(event.personnelId)?.name ?? event.personnelId} arrived at ${
                          getLocationLabel(event.toLocationId)
                        } from ${getLocationLabel(event.fromLocationId)}`}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
};
