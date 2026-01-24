import { useEffect, useMemo, useRef, useState } from "react";
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
import sectorsData from "../data/sectors.json";
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

const parseSectorCoords = (coords: string) => {
  const numbers = coords.split(",").map((value) => Number(value.trim()));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < numbers.length; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y });
    }
  }
  return points;
};

export const App = () => {
  const initialScenario = (() => {
    const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
    const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
    return refreshMissionOffers(scenario);
  })();

  const [state, setState] = useState<GameState>(() => initialScenario);
  const [speedIndex, setSpeedIndex] = useState<number>(2);
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    initialScenario.missionPlans[0]?.id ?? "",
  );
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>("");
  const [mapLevel, setMapLevel] = useState<"galaxy" | "sector" | "planet">(
    "galaxy",
  );
  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    initialScenario.sectors[0]?.id ?? "",
  );
  const [selectedPlanetId, setSelectedPlanetId] = useState<string>(
    initialScenario.planets[0]?.id ?? "",
  );
  const [selectedMapLocationId, setSelectedMapLocationId] = useState<string>(
    initialScenario.locations[0]?.id ?? "",
  );
  const activeMissions = useMemo(
    () => state.missions.filter((mission) => mission.status === "active"),
    [state.missions],
  );
  const selectedPlan = useMemo(
    () => state.missionPlans.find((plan) => plan.id === selectedPlanId),
    [state.missionPlans, selectedPlanId],
  );
  const planById = useMemo(
    () => new Map(state.missionPlans.map((plan) => [plan.id, plan])),
    [state.missionPlans],
  );
  const planetById = useMemo(
    () => new Map(state.planets.map((planet) => [planet.id, planet])),
    [state.planets],
  );
  const sectorById = useMemo(
    () => new Map(state.sectors.map((sector) => [sector.id, sector])),
    [state.sectors],
  );
  const locationById = useMemo(
    () => new Map(state.locations.map((location) => [location.id, location])),
    [state.locations],
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
  const selectedPersonnel = useMemo(() => {
    if (!selectedPersonnelId) {
      return null;
    }
    return (
      state.personnel.find((person) => person.id === selectedPersonnelId) ?? null
    );
  }, [selectedPersonnelId, state.personnel]);
  const assignmentErrors = useMemo(() => {
    if (!selectedPlan) {
      return ["Select an assignment."];
    }
    if (!selectedPersonnel) {
      return ["Select personnel."];
    }
    return validateAssignment(state, selectedPlan, [selectedPersonnel]);
  }, [selectedPlan, selectedPersonnel, state]);
  const selectedPersonnelLocationId = useMemo(() => {
    if (!selectedPersonnel) {
      return null;
    }
    return selectedPersonnel.locationId ?? null;
  }, [selectedPersonnel]);
  const availableOffers = useMemo(() => {
    if (!selectedPersonnelLocationId) {
      return [];
    }
    return state.missionOffers.filter(
      (offer) => offer.locationId === selectedPersonnelLocationId,
    );
  }, [state.missionOffers, selectedPersonnelLocationId]);

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

  const selectedOffer = useMemo(
    () =>
      availableOffers.find((offer) => offer.planId === selectedPlanId) ?? null,
    [availableOffers, selectedPlanId],
  );

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
  const personnelById = useMemo(
    () => new Map(state.personnel.map((person) => [person.id, person])),
    [state.personnel],
  );
  const [travelPersonnelId, setTravelPersonnelId] = useState<string>(
    initialScenario.personnel[0]?.id ?? "",
  );
  const [travelDestinationId, setTravelDestinationId] = useState<string>(
    initialScenario.locations[0]?.id ?? "",
  );
  const [travelHours, setTravelHours] = useState<number>(12);
  const missionListRows = Math.max(4, availablePlans.length);
  const selectedLocation = useMemo(
    () =>
      selectedPersonnelLocationId && selectedPersonnelLocationId !== "mixed"
        ? state.locations.find(
            (location) => location.id === selectedPersonnelLocationId,
          )
        : null,
    [selectedPersonnelLocationId, state.locations],
  );
  const rewardModifier = useMemo(
    () =>
      selectedLocation
        ? getMaterialRewardModifier(state, selectedLocation.id)
        : null,
    [selectedLocation, state],
  );
  const timeAccumulatorRef = useRef(
    createHourAccumulator(SPEEDS[2], initialScenario.nowHours),
  );
  const [toasts, setToasts] = useState<
    Array<{ id: string; message: string }>
  >([]);
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
    setSelectedPlanId(loaded.missionPlans[0]?.id ?? "");
    setSelectedPersonnelId("");
    setSelectedMapLocationId(loaded.locations[0]?.id ?? "");
    setSelectedSectorId(loaded.sectors[0]?.id ?? "");
    setSelectedPlanetId(loaded.planets[0]?.id ?? "");
    setMapLevel("galaxy");
    pushToast("Game loaded from local save.");
  };
  const lastEventIdRef = useRef<string | null>(null);
  const hourOfDay = getHourOfDay(state.nowHours);
  const hourFill = (hourOfDay / 24) * 100;
  const universeDate = getUniverseDate(state.nowHours);
  const year = universeDate.getUTCFullYear();
  const month = universeDate.getUTCMonth() + 1;
  const day = universeDate.getUTCDate();
  const selectedSector = useMemo(
    () => state.sectors.find((sector) => sector.id === selectedSectorId),
    [state.sectors, selectedSectorId],
  );
  const selectedPlanet = useMemo(
    () => state.planets.find((planet) => planet.id === selectedPlanetId),
    [state.planets, selectedPlanetId],
  );
  const selectedMapLocation = useMemo(
    () => state.locations.find((location) => location.id === selectedMapLocationId),
    [state.locations, selectedMapLocationId],
  );

  const sectorBounds = useMemo(() => {
    if (!selectedSector) {
      return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }
    const xs = selectedSector.polygon.map((p) => p.x);
    const ys = selectedSector.polygon.map((p) => p.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }, [selectedSector]);

  const sectorPolygons = useMemo(() => {
    return (sectorsData as Array<{ title: string; coords: string }>).map(
      (sector) => ({
        name: sector.title,
        points: parseSectorCoords(sector.coords),
      }),
    );
  }, []);

  const galaxyBounds = useMemo(() => {
    if (sectorPolygons.length === 0) {
      return { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    }
    const xs = sectorPolygons.flatMap((sector) => sector.points.map((p) => p.x));
    const ys = sectorPolygons.flatMap((sector) => sector.points.map((p) => p.y));
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }, [sectorPolygons]);

  const galaxyPoints = useMemo(
    () =>
      state.sectors.map((sector) => {
        const xs = sector.polygon.map((p) => p.x);
        const ys = sector.polygon.map((p) => p.y);
        return {
          id: sector.id,
          name: sector.name,
          x: xs.reduce((a, b) => a + b, 0) / xs.length,
          y: ys.reduce((a, b) => a + b, 0) / ys.length,
        };
      }),
    [state.sectors],
  );

  const sectorPlanets = useMemo(
    () => state.planets.filter((planet) => planet.sectorId === selectedSectorId),
    [state.planets, selectedSectorId],
  );

  const planetLocations = useMemo(
    () => state.locations.filter((location) => location.planetId === selectedPlanetId),
    [state.locations, selectedPlanetId],
  );
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

  const handleAssignSample = () => {
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
          } at ${locationById.get(latest.locationId)?.name ?? latest.locationId}`
        : latest.status === "started"
          ? `${personnelById.get(latest.personnelId)?.name ?? latest.personnelId} departed ${
              locationById.get(latest.fromLocationId)?.name ?? latest.fromLocationId
            } for ${
              locationById.get(latest.toLocationId)?.name ?? latest.toLocationId
            } (${latest.travelHours ?? 0}h)`
          : `${personnelById.get(latest.personnelId)?.name ?? latest.personnelId} arrived at ${
              locationById.get(latest.toLocationId)?.name ?? latest.toLocationId
            } from ${
              locationById.get(latest.fromLocationId)?.name ?? latest.fromLocationId
            }`;
    const toast = { id: latest.id, message };
    setToasts((prev) => [...prev, toast]);
  }, [state.eventLog, planById, personnelById]);

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

  const getPersonnelOptionStyle = (person: Personnel) => {
    const isUnavailable = person.status === "wounded" || person.status === "assigned";
    return isUnavailable ? { color: "#6b7280" } : undefined;
  };

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
          {formatResources(state)}
          <div className="meta">
            In-universe time: {formatInUniverseTime(state.nowHours)}
          </div>
          <div className="time-indicator">
            <div className="date-indicator">
              <div className="date-year">
                <span className="date-icon" aria-hidden="true">
                  📅
                </span>
                <span key={`year-${yearFlashKey}`} className="flash-text">
                  Y:{year}
                </span>
              </div>
              <div className="date-md">
                <span key={`month-${monthFlashKey}`} className="flash-text">
                  M:{String(month).padStart(2, "0")}
                </span>{" "}
                ·{" "}
                <span key={`day-${dayFlashKey}`} className="flash-text">
                  D:{String(day).padStart(2, "0")}
                </span>
              </div>
            </div>
            <div className="time-dial-wrap">
              <div
                key={`dial-${dialFlashKey}`}
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
          <h2>Personnel</h2>
          <ul>
            {state.personnel.map((person) => (
              <li key={person.id}>
                <strong>{person.name}</strong> · {person.skills.join(", ")} ·{" "}
                {person.traits?.join(", ") ?? "no traits"} · {person.status} ·{" "}
                {person.locationId}
              </li>
            ))}
          </ul>
          <h3>Personnel Details</h3>
          <label className="field">
            Personnel
            <select
              value={selectedPersonnelId}
              onChange={(event) => setSelectedPersonnelId(event.target.value)}
              size={Math.max(4, Math.min(8, state.personnel.length))}
              style={{
                height: `${Math.max(4, Math.min(8, state.personnel.length)) * 2.1}rem`,
              }}
            >
              <option value="">-- choose --</option>
              {state.personnel.map((person) => (
                <option
                  key={person.id}
                  value={person.id}
                  style={getPersonnelOptionStyle(person)}
                >
                  {person.name} · {person.skills.join(", ")} · {person.locationId}
                </option>
              ))}
            </select>
          </label>
          {selectedPersonnel ? (
            <div className="meta">
              {selectedPersonnel.name} · {selectedPersonnel.skills.join(", ")} ·{" "}
              {selectedPersonnel.traits?.join(", ") ?? "no traits"} ·{" "}
              {selectedPersonnel.status} · {selectedPersonnel.locationId}
            </div>
          ) : (
            <div className="meta">Select personnel to view details.</div>
          )}
          <h3>Travel Orders</h3>
          <label className="field">
            Personnel
            <select
              value={travelPersonnelId}
              onChange={(event) => setTravelPersonnelId(event.target.value)}
            >
              {state.personnel.map((person) => (
                <option key={person.id} value={person.id} style={getPersonnelOptionStyle(person)}>
                  {person.name} · {person.skills.join(", ")} ·{" "}
                  {person.traits?.join(", ") ?? "no traits"} · {person.status} ·{" "}
                  {person.locationId}
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
              {state.locations.map((location) => {
                const planet = planetById.get(location.planetId);
                const sector = planet ? sectorById.get(planet.sectorId) : null;
                return (
                <option key={location.id} value={location.id}>
                  {location.name} · {planet?.name ?? location.planetId} ·{" "}
                  {sector?.name ?? planet?.sectorId ?? "unknown sector"}
                </option>
                );
              })}
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
                  · {assignment.fromLocationId} → {assignment.toLocationId} ·{" "}
                  {assignment.remainingHours}h remaining
                </li>
              ))}
            </ul>
          ) : (
            <p>No active travel.</p>
          )}
        </div>

        <div className="card">
          <h2>Assignment Planning</h2>
          {selectedPersonnelId.length === 0 ? (
            <div className="meta">Select personnel to see assignments.</div>
          ) : (
            <div className="meta">
              Assignments at{" "}
              {state.locations.find(
                (location) => location.id === selectedPersonnelLocationId,
              )?.name ?? selectedPersonnelLocationId}
            </div>
          )}
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
          {selectedPersonnelId.length > 0 && availablePlans.length === 0 ? (
            <div className="meta">No assignments available right now.</div>
          ) : null}
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
              ) : (
                <div className="meta">Materials: none</div>
              )}
              <div className="meta">
                Rewards:{" "}
                {[
                  selectedPlan.rewards.credits
                    ? `${selectedPlan.rewards.credits} credits`
                    : null,
                  selectedPlan.rewards.intel
                    ? `${selectedPlan.rewards.intel} intel`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "none"}
              </div>
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
              onClick={handleAssignSample}
              disabled={assignmentErrors.length > 0}
              title={
                assignmentErrors.length > 0
                  ? assignmentErrors.join(" ")
                  : "Assign personnel to this assignment."
              }
            >
              Assign
            </button>
          </div>
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
        <h2>Active Assignments</h2>
        {activeMissions.length === 0 ? (
          <p>No active assignments.</p>
        ) : (
          <ul>
            {activeMissions.map((mission) => (
              <li key={mission.id}>
                {planById.get(mission.planId)?.name ?? mission.planId} ·{" "}
                {locationById.get(mission.locationId)?.name ?? mission.locationId} ·{" "}
                {mission.remainingHours}h remaining · pers{" "}
                {mission.assignedPersonnelIds
                  .map((id) => personnelById.get(id)?.name ?? id)
                  .join(", ")}
              </li>
            ))}
          </ul>
        )}
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
                    ? `${planById.get(event.planId)?.name ?? event.planId} · ${
                        event.success ? "success" : "failed"
                      } · ${formatInUniverseTime(event.resolvedAtHours)}`
                    : `${personnelById.get(event.personnelId)?.name ??
                        event.personnelId} · travel ${
                        event.status
                      } · ${event.fromLocationId} → ${
                        event.toLocationId
                      } · ${formatInUniverseTime(event.atHours)}`}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="card map-section">
        <div className="map-header">
          <h2>
            Map · {mapLevel === "galaxy"
              ? "Galaxy"
              : mapLevel === "sector"
                ? "Sector"
                : "Planet"}
          </h2>
          {mapLevel !== "galaxy" ? (
            <button
              type="button"
              onClick={() =>
                setMapLevel(mapLevel === "planet" ? "sector" : "galaxy")
              }
            >
              Back
            </button>
          ) : null}
        </div>
        {mapLevel === "galaxy" ? (
          <svg
            className="map-svg map-svg-large"
            viewBox={`${galaxyBounds.minX - 10} ${galaxyBounds.minY - 10} ${
              galaxyBounds.maxX - galaxyBounds.minX + 20
            } ${galaxyBounds.maxY - galaxyBounds.minY + 20}`}
          >
            {sectorPolygons.map((sector) => (
              <polygon
                key={sector.name}
                className="map-sector-polygon"
                points={sector.points.map((p) => `${p.x},${p.y}`).join(" ")}
              >
                <title>{sector.name}</title>
              </polygon>
            ))}
            {state.sectors.map((sector) => (
              <g
                key={sector.id}
                className={
                  sector.id === selectedSectorId
                    ? "map-sector selected"
                    : "map-sector"
                }
                onClick={() => {
                  setSelectedSectorId(sector.id);
                  setMapLevel("sector");
                }}
              >
                <polygon
                  points={sector.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                >
                  <title>{sector.name}</title>
                </polygon>
                <text
                  x={sector.polygon.reduce((sum, p) => sum + p.x, 0) / sector.polygon.length}
                  y={sector.polygon.reduce((sum, p) => sum + p.y, 0) / sector.polygon.length}
                >
                  {sector.name}
                </text>
              </g>
            ))}
          </svg>
        ) : mapLevel === "sector" ? (
          <svg
            className="map-svg map-svg-large"
            viewBox={`${sectorBounds.minX - 10} ${sectorBounds.minY - 10} ${
              sectorBounds.maxX - sectorBounds.minX + 20
            } ${sectorBounds.maxY - sectorBounds.minY + 20}`}
          >
            {sectorPlanets.map((planet) => (
              <g
                key={planet.id}
                className={
                  planet.id === selectedPlanetId ? "map-node selected" : "map-node"
                }
                onClick={() => {
                  setSelectedPlanetId(planet.id);
                  setMapLevel("planet");
                }}
              >
                <circle cx={planet.position.x} cy={planet.position.y} r={6} />
                <text x={planet.position.x + 8} y={planet.position.y + 4}>
                  {planet.name}
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <svg className="map-svg map-svg-large" viewBox="0 0 100 100">
            {planetLocations.map((location) => (
              <g
                key={location.id}
                className={
                  location.id === selectedMapLocationId
                    ? "map-node selected"
                    : "map-node"
                }
                onClick={() => setSelectedMapLocationId(location.id)}
              >
                <circle cx={location.position.x} cy={location.position.y} r={5} />
                <text x={location.position.x + 7} y={location.position.y + 4}>
                  {location.name}
                </text>
              </g>
            ))}
          </svg>
        )}
        <div className="meta">Click to drill down into the map hierarchy.</div>
      </section>

      <section className="card">
        <h2>Map Details</h2>
        {mapLevel === "galaxy" ? (
          selectedSector ? (
            <>
              <div className="meta">
                <strong>{selectedSector.name}</strong> ·{" "}
                {selectedSector.tags.join(", ")}
              </div>
              <div className="meta">Polygon points: {selectedSector.polygon.length}</div>
            </>
          ) : (
            <p>Select a sector to see details.</p>
          )
        ) : mapLevel === "sector" ? (
          selectedPlanet ? (
            <>
              <div className="meta">
                <strong>{selectedPlanet.name}</strong> ·{" "}
                {selectedPlanet.tags.join(", ")}
              </div>
              <div className="meta">
                Sector: {selectedPlanet.sectorId} · Position ({selectedPlanet.position.x},
                {selectedPlanet.position.y})
              </div>
            </>
          ) : (
            <p>Select a planet to see details.</p>
          )
        ) : selectedMapLocation ? (
          <>
            <div className="meta">
              <strong>{selectedMapLocation.name}</strong> ·{" "}
              {selectedMapLocation.tags.join(", ")}
            </div>
            <div className="meta">
              Planet: {selectedMapLocation.planetId} · Local (
              {selectedMapLocation.position.x},{selectedMapLocation.position.y})
            </div>
            <div className="meta">
              Resistance {selectedMapLocation.attributes.resistance} · Healthcare{" "}
              {selectedMapLocation.attributes.healthcareFacilities} · Tech{" "}
              {selectedMapLocation.attributes.techLevel}
            </div>
            <div className="meta">
              Pop density {selectedMapLocation.attributes.populationDensity} · Customs{" "}
              {selectedMapLocation.attributes.customsScrutiny}
            </div>
            <div className="meta">
              Patrols {selectedMapLocation.attributes.patrolFrequency} · Garrison{" "}
              {selectedMapLocation.attributes.garrisonStrength}
            </div>
          </>
        ) : (
          <p>Select a location on the map to see details.</p>
        )}
      </section>
    </div>
  );
};
