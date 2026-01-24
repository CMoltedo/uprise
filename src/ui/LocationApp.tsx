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
import { SPEEDS, createHourAccumulator, getHourOfDay, getUniverseDate } from "../time.js";
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
  const [mapLevel, setMapLevel] = useState<"galaxy" | "sector" | "planet">(
    "galaxy",
  );
  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    initialScenario.sectors[0]?.id ?? "",
  );
  const [selectedPlanetId, setSelectedPlanetId] = useState<string>(
    initialScenario.planets[0]?.id ?? "",
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    initialScenario.locations[0]?.id ?? "",
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    initialScenario.missionPlans[0]?.id ?? "",
  );
  const [travelPersonnelId, setTravelPersonnelId] = useState<string>(
    initialScenario.personnel[0]?.id ?? "",
  );
  const [travelDestinationId, setTravelDestinationId] = useState<string>(
    initialScenario.locations[0]?.id ?? "",
  );
  const [travelHours, setTravelHours] = useState<number>(12);
  const [dragPlanId, setDragPlanId] = useState<string | null>(null);
  const [hoverPlanId, setHoverPlanId] = useState<string | null>(null);
  const [dragPersonnelId, setDragPersonnelId] = useState<string | null>(null);
  const [mapDropLocationId, setMapDropLocationId] = useState<string | null>(null);
  const [showConsoleMenu, setShowConsoleMenu] = useState<boolean>(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const consolePanelRef = useRef<HTMLDivElement | null>(null);

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
  const personnelByLocationId = useMemo(() => {
    const map = new Map<string, Personnel[]>();
    for (const person of state.personnel) {
      const existing = map.get(person.locationId);
      if (existing) {
        existing.push(person);
      } else {
        map.set(person.locationId, [person]);
      }
    }
    return map;
  }, [state.personnel]);
  const personnelCountByPlanetId = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of state.personnel) {
      const location = locationById.get(person.locationId);
      if (!location) {
        continue;
      }
      map.set(location.planetId, (map.get(location.planetId) ?? 0) + 1);
    }
    return map;
  }, [state.personnel, locationById]);
  const personnelCountBySectorId = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of state.personnel) {
      const location = locationById.get(person.locationId);
      if (!location) {
        continue;
      }
      const planet = planetById.get(location.planetId);
      if (!planet) {
        continue;
      }
      map.set(planet.sectorId, (map.get(planet.sectorId) ?? 0) + 1);
    }
    return map;
  }, [state.personnel, locationById, planetById]);
  const sectorPlanets = useMemo(
    () => state.planets.filter((planet) => planet.sectorId === selectedSectorId),
    [state.planets, selectedSectorId],
  );
  const planetLocations = useMemo(
    () => state.locations.filter((location) => location.planetId === selectedPlanetId),
    [state.locations, selectedPlanetId],
  );
  const locationPersonnel = useMemo(() => {
    if (mapLevel === "galaxy") {
      return state.personnel;
    }
    if (mapLevel === "sector") {
      return state.personnel.filter((person) => {
        const location = locationById.get(person.locationId);
        if (!location) {
          return false;
        }
        const planet = planetById.get(location.planetId);
        return planet?.sectorId === selectedSectorId;
      });
    }
    if (mapLevel === "planet") {
      return state.personnel.filter((person) => {
        const location = locationById.get(person.locationId);
        return location?.planetId === selectedPlanetId;
      });
    }
    return state.personnel.filter(
      (person) => person.locationId === selectedLocationId,
    );
  }, [
    mapLevel,
    state.personnel,
    selectedLocationId,
    selectedSectorId,
    selectedPlanetId,
    locationById,
    planetById,
  ]);

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
  const timePlanCount = useMemo(
    () =>
      state.missionPlans.filter(
        (plan) =>
          plan.availability?.type === "time" &&
          state.nowHours >= plan.availability.startHours &&
          state.nowHours <= plan.availability.endHours,
      ).length,
    [state.missionPlans, state.nowHours],
  );
  const missionCountByLocationId = useMemo(() => {
    const map = new Map<string, number>();
    for (const location of state.locations) {
      map.set(location.id, timePlanCount);
    }
    for (const offer of state.missionOffers) {
      map.set(offer.locationId, (map.get(offer.locationId) ?? 0) + 1);
    }
    return map;
  }, [state.locations, state.missionOffers, timePlanCount]);
  const getPlanSortValue = (plan: typeof availablePlans[number]) => {
    const offerHours = offerHoursByPlanId.get(plan.id);
    if (offerHours !== undefined) {
      return offerHours;
    }
    if (plan.availability?.type === "time") {
      return Math.max(0, plan.availability.endHours - state.nowHours);
    }
    if (plan.availability?.type === "global") {
      return -1;
    }
    return Number.POSITIVE_INFINITY;
  };
  const sortedAvailablePlans = useMemo(
    () =>
      [...availablePlans].sort((a, b) => {
        const diff = getPlanSortValue(a) - getPlanSortValue(b);
        if (diff !== 0) {
          return diff;
        }
        return a.name.localeCompare(b.name);
      }),
    [availablePlans, offerHoursByPlanId, state.nowHours],
  );

  const selectedPlan = useMemo(
    () => state.missionPlans.find((plan) => plan.id === selectedPlanId),
    [state.missionPlans, selectedPlanId],
  );
  const selectedOffer = useMemo(
    () =>
      availableOffers.find((offer) => offer.planId === selectedPlanId) ?? null,
    [availableOffers, selectedPlanId],
  );
  const activeMissions = useMemo(
    () =>
      state.missions.filter(
        (mission) =>
          mission.status === "active" && mission.locationId === selectedLocationId,
      ),
    [state.missions, selectedLocationId],
  );
  const activeMissionsAll = useMemo(
    () =>
      [...state.missions]
        .filter((mission) => mission.status === "active")
        .sort((a, b) => a.remainingHours - b.remainingHours),
    [state.missions],
  );
  const missionByPersonnelId = useMemo(() => {
    const map = new Map<string, typeof state.missions[number]>();
    for (const mission of activeMissionsAll) {
      for (const id of mission.assignedPersonnelIds) {
        const existing = map.get(id);
        if (!existing || mission.remainingHours < existing.remainingHours) {
          map.set(id, mission);
        }
      }
    }
    return map;
  }, [activeMissionsAll]);

  const rewardModifier = useMemo(
    () =>
      selectedLocation ? getMaterialRewardModifier(state, selectedLocation.id) : null,
    [selectedLocation, state],
  );

  const timeAccumulatorRef = useRef(
    createHourAccumulator(SPEEDS[2], initialScenario.nowHours),
  );
  const [toasts, setToasts] = useState<
    Array<{
      id: string;
      parts: Array<
        | { kind: "text"; value: string }
        | { kind: "location"; value: string; locationId: string }
      >;
    }>
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
    setToasts((prev) => [...prev, { id, parts: [{ kind: "text", value: message }] }]);
  };
  const jumpToLocation = (locationId: string) => {
    setSelectedLocationId(locationId);
    setMapLevel("planet");
    const location = locationById.get(locationId);
    if (location) {
      setSelectedPlanetId(location.planetId);
      const planet = planetById.get(location.planetId);
      if (planet) {
        setSelectedSectorId(planet.sectorId);
      }
    }
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
    setMapLevel("galaxy");
    setSelectedSectorId(loaded.sectors[0]?.id ?? "");
    setSelectedPlanetId(loaded.planets[0]?.id ?? "");
    setSelectedLocationId(loaded.locations[0]?.id ?? "");
    setSelectedPlanId(loaded.missionPlans[0]?.id ?? "");
    setTravelPersonnelId(loaded.personnel[0]?.id ?? "");
    setTravelDestinationId(loaded.locations[0]?.id ?? "");
    pushToast("Game loaded from local save.");
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

  const canTravelTo = (person: Personnel | null, locationId: string) => {
    if (!person) {
      return false;
    }
    if (person.status !== "idle") {
      return false;
    }
    return person.locationId !== locationId;
  };

  const handleDragStart =
    (personId: string) => (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData("text/plain", personId);
      event.dataTransfer.effectAllowed = "move";
      setDragPersonnelId(personId);
    };

  const handleDropOnPlan =
    (planId: string) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragPlanId(null);
      setHoverPlanId(null);
      setDragPersonnelId(null);
      setMapDropLocationId(null);
      const personId = event.dataTransfer.getData("text/plain");
      if (!personId) {
        return;
      }
      const person = personnelById.get(personId);
      const plan = planById.get(planId);
      if (!person || !plan) {
        return;
      }
      const errors = validateAssignment(state, plan, [person], selectedLocationId);
      if (errors.length > 0) {
        pushToast(errors[0]);
        setSelectedPlanId(planId);
        return;
      }
      const next = assignPersonnelToMission(
        state,
        planId,
        [personId],
        selectedLocationId,
      );
      setState(next);
      setSelectedPlanId(planId);
    };

  const handleDropOnLocation =
    (locationId: string) => (event: DragEvent<SVGGElement>) => {
      event.preventDefault();
      setMapDropLocationId(null);
      const personId = event.dataTransfer.getData("text/plain");
      if (!personId) {
        return;
      }
      const person = personnelById.get(personId);
      if (!person) {
        return;
      }
      if (!canTravelTo(person, locationId)) {
        pushToast("Cannot travel: agent is busy or already there.");
        return;
      }
      try {
        const next = assignTravel(state, personId, locationId, travelHours);
        setState(next);
        setSelectedLocationId(locationId);
      } catch (error) {
        console.error(error);
        pushToast(error instanceof Error ? error.message : "Travel failed");
      }
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

  const getContextLabel = () => {
    if (mapLevel === "galaxy") {
      return "Galaxy";
    }
    if (mapLevel === "sector") {
      return sectorById.get(selectedSectorId)?.name ?? "Unknown sector";
    }
    if (mapLevel === "planet") {
      const planet = planetById.get(selectedPlanetId);
      const sector = planet ? sectorById.get(planet.sectorId) : null;
      return `${sector?.name ?? planet?.sectorId ?? "Unknown sector"} · ${
        planet?.name ?? "Unknown planet"
      }`;
    }
    return getLocationLabel(selectedLocationId);
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
    const makeLocationPart = (locationId: string) => ({
      kind: "location" as const,
      value: getLocationLabel(locationId),
      locationId,
    });
    const parts =
      latest.kind === "mission"
        ? ([
            {
              kind: "text",
              value: `${latest.success ? "Successful" : "Failed"} mission by ${
                latest.personnelIds
                  .map((id) => personnelById.get(id)?.name ?? id)
                  .join(", ")
              } at `,
            },
            makeLocationPart(latest.locationId),
          ] as const)
        : latest.status === "started"
          ? ([
              {
                kind: "text",
                value: `${
                  personnelById.get(latest.personnelId)?.name ?? latest.personnelId
                } departed `,
              },
              makeLocationPart(latest.fromLocationId),
              { kind: "text", value: " for " },
              makeLocationPart(latest.toLocationId),
              { kind: "text", value: ` (${latest.travelHours ?? 0}h)` },
            ] as const)
          : ([
              {
                kind: "text",
                value: `${
                  personnelById.get(latest.personnelId)?.name ?? latest.personnelId
                } arrived at `,
              },
              makeLocationPart(latest.toLocationId),
              { kind: "text", value: " from " },
              makeLocationPart(latest.fromLocationId),
            ] as const);
    const toast = { id: latest.id, parts: [...parts] };
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
    if (locationById.has(selectedLocationId)) {
      return;
    }
    setSelectedLocationId(state.locations[0]?.id ?? "");
  }, [locationById, selectedLocationId, state.locations]);

  useEffect(() => {
    const header = headerRef.current;
    const panel = consolePanelRef.current;
    if (!header || !panel || typeof ResizeObserver === "undefined") {
      return;
    }
    const updateSize = () => {
      const rect = panel.getBoundingClientRect();
      header.style.setProperty("--console-width", `${Math.ceil(rect.width)}px`);
      header.style.setProperty("--console-height", `${Math.ceil(rect.height)}px`);
    };
    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const location = locationById.get(selectedLocationId);
    if (!location) {
      return;
    }
    if (location.planetId !== selectedPlanetId) {
      setSelectedPlanetId(location.planetId);
    }
    const planet = planetById.get(location.planetId);
    if (planet && planet.sectorId !== selectedSectorId) {
      setSelectedSectorId(planet.sectorId);
    }
  }, [locationById, planetById, selectedLocationId, selectedPlanetId, selectedSectorId]);

  return (
    <div className="page">
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <span>
              {toast.parts.map((part, index) =>
                part.kind === "location" ? (
                  <button
                    key={`${toast.id}-loc-${part.locationId}-${index}`}
                    type="button"
                    className="toast-location"
                    onClick={() => jumpToLocation(part.locationId)}
                  >
                    {part.value}
                  </button>
                ) : (
                  <span key={`${toast.id}-text-${index}`}>{part.value}</span>
                ),
              )}
            </span>
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
      <header className="header" ref={headerRef}>
        <div className="card header-missions">
          <h2>Completing Soon</h2>
          {activeMissions.filter((mission) => mission.remainingHours <= 5).length === 0 ? (
            <p>No assignments finishing soon.</p>
          ) : (
            <ul className="header-missions-list">
              {activeMissions
                .filter((mission) => mission.remainingHours <= 5)
                .map((mission) => (
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
        <div className="card header-resources">
          <div className="header-resources-header">
            <h2 className="header-resources-title">Resources</h2>
            <div className="meta header-resources-meta">{formatResources(state)}</div>
          </div>
          <ul className="header-resources-list">
            {state.materials.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> · qty {item.quantity}
              </li>
            ))}
          </ul>
        </div>
        <div className="header-console">
          <div className="resources" ref={consolePanelRef}>
            <div className="console-menu">
              <button
                type="button"
                className="console-menu-trigger"
                aria-label="Open command menu"
                onClick={() => setShowConsoleMenu((prev) => !prev)}
              >
                ⋮
              </button>
              {showConsoleMenu ? (
                <div className="console-menu-panel">
                  <button type="button" onClick={handleSave}>
                    Save
                  </button>
                  <button type="button" onClick={handleLoad}>
                    Load
                  </button>
                </div>
              ) : null}
            </div>
            <div className="time-indicator-grid">
              <div className="date-indicator">
                <div className="date-line">
                  <span className="date-icon">🗓️</span>
                  <span key={yearFlashKey} className="date-year-text flash-text">
                    {year}
                  </span>
                  <span className="date-md">
                    <span key={monthFlashKey} className="flash-text">
                      {month.toString().padStart(2, "0")}
                    </span>
                    -
                    <span key={dayFlashKey} className="flash-text">
                      {day.toString().padStart(2, "0")}
                    </span>
                  </span>
                  <span className="date-md">{hourOfDay}h</span>
                </div>
              </div>
              <div className="speed-indicator meta">
                Speed: {SPEEDS[speedIndex]?.label}
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
                className="speed-button"
                onClick={() => setSpeedIndex((prev) => Math.max(0, prev - 1))}
              >
                Slower
              </button>
              <button
                type="button"
                className="speed-button"
                onClick={() =>
                  setSpeedIndex((prev) => Math.min(SPEEDS.length - 1, prev + 1))
                }
              >
                Faster
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="card map-panel">
        <div className="map-header">
          <h2>Galaxy Map</h2>
          <div className="map-breadcrumbs">
            <button type="button" onClick={() => setMapLevel("galaxy")}>
              Galaxy
            </button>
            <button
              type="button"
              onClick={() => selectedSectorId && setMapLevel("sector")}
              disabled={!selectedSectorId}
            >
              Sector
            </button>
            <button
              type="button"
              onClick={() => selectedPlanetId && setMapLevel("planet")}
              disabled={!selectedPlanetId}
            >
              Planet
            </button>
          </div>
        </div>
        {mapLevel === "galaxy" ? (
          <svg className="map-svg map-svg-large" viewBox="0 0 120 120">
            {[
              { x: 5, y: 5 },
              { x: 61, y: 5 },
              { x: 5, y: 61 },
              { x: 61, y: 61 },
            ].map((position, index) => {
              const sector = state.sectors[index];
              const count = sector
                ? personnelCountBySectorId.get(sector.id) ?? 0
                : 0;
              if (!sector) {
                return (
                  <g key={`sector-slot-${index}`}>
                    <rect
                      x={position.x}
                      y={position.y}
                      width={54}
                      height={54}
                      rx={6}
                      className="map-sector-rect is-empty"
                    />
                    <text
                      x={position.x + 27}
                      y={position.y + 30}
                      className="map-label"
                      textAnchor="middle"
                    >
                      Uncharted
                    </text>
                  </g>
                );
              }
              const isSelected = sector.id === selectedSectorId;
              return (
                <g
                  key={sector.id}
                  className={`map-sector-rect${isSelected ? " selected" : ""}`}
                  onClick={() => {
                    setSelectedSectorId(sector.id);
                    setMapLevel("sector");
                  }}
                >
                  <rect x={position.x} y={position.y} width={54} height={54} rx={6} />
                  <text
                    x={position.x + 27}
                    y={position.y + 26}
                    className="map-label"
                    textAnchor="middle"
                  >
                    {sector.name}
                  </text>
                  <text
                    x={position.x + 27}
                    y={position.y + 40}
                    className="map-label"
                    textAnchor="middle"
                  >
                    {count} agents
                  </text>
                </g>
              );
            })}
          </svg>
        ) : mapLevel === "sector" ? (
          <svg className="map-svg map-svg-large" viewBox="0 0 120 120">
            {sectorPlanets.map((planet) => (
              <g key={planet.id}>
                <circle
                  cx={planet.position.x}
                  cy={planet.position.y}
                  r={6}
                  className="map-node"
                  onClick={() => {
                    setSelectedPlanetId(planet.id);
                    setMapLevel("planet");
                    const firstLocation = state.locations.find(
                      (location) => location.planetId === planet.id,
                    );
                    if (firstLocation) {
                      setSelectedLocationId(firstLocation.id);
                    }
                  }}
                />
                <text
                  x={planet.position.x + 8}
                  y={planet.position.y + 4}
                  className="map-label"
                >
                  {planet.name}
                </text>
                <text
                  x={planet.position.x + 8}
                  y={planet.position.y + 12}
                  className="map-label"
                >
                  {personnelCountByPlanetId.get(planet.id) ?? 0} agents
                </text>
              </g>
            ))}
          </svg>
        ) : (
          <svg className="map-svg map-svg-large" viewBox="0 0 120 120">
            {planetLocations.map((location) => {
              const dragPerson = dragPersonnelId
                ? personnelById.get(dragPersonnelId) ?? null
                : null;
              const canDrop = canTravelTo(dragPerson, location.id);
              const isOver = mapDropLocationId === location.id;
              return (
              <g
                key={location.id}
                onDragOver={(event) => {
                  event.preventDefault();
                  setMapDropLocationId(location.id);
                }}
                onDragLeave={() => setMapDropLocationId(null)}
                onDrop={handleDropOnLocation(location.id)}
              >
                <circle
                  cx={location.position.x}
                  cy={location.position.y}
                  r={4}
                  className={`map-node map-drop-target${
                    isOver
                      ? canDrop
                        ? " is-drop-over"
                        : " is-drop-invalid"
                      : ""
                  }`}
                  onClick={() => setSelectedLocationId(location.id)}
                />
                <text
                  x={location.position.x + 6}
                  y={location.position.y + 4}
                  className="map-label"
                >
                  {location.name}
                </text>
                <text
                  x={location.position.x + 6}
                  y={location.position.y + 12}
                  className="map-label"
                >
                  {missionCountByLocationId.get(location.id) ?? 0} missions
                </text>
              </g>
            )})}
          </svg>
        )}
        <div className="meta">
          Selected: {getLocationLabel(selectedLocationId)}
        </div>
        <div className="meta">
          Drag personnel onto a location (planet view) to travel.
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Location Info - {getContextLabel()}</h2>
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
          <div className="meta">Personnel in view: {locationPersonnel.length}</div>
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
                  onDragEnd={() => {
                    setDragPlanId(null);
                    setHoverPlanId(null);
                    setDragPersonnelId(null);
                    setMapDropLocationId(null);
                  }}
                >
                  <strong>{person.name}</strong>
                  <div className="meta">
                    {person.skills.join(", ")} · {person.status}
                  </div>
                  {missionByPersonnelId.get(person.id) ? (
                    <div className="meta">
                      Mission:{" "}
                      {planById.get(missionByPersonnelId.get(person.id)!.planId)?.name ??
                        missionByPersonnelId.get(person.id)!.planId}{" "}
                      · {missionByPersonnelId.get(person.id)!.remainingHours}h left
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Assignment Planning - {getContextLabel()}</h2>
          <div className="meta">
            Assignments at {getLocationLabel(selectedLocationId)}
          </div>
          <div className="meta">Drag a personnel card onto a mission to assign.</div>
          <div className="mission-drop-list">
            {sortedAvailablePlans.map((plan) => {
              const dragPerson = dragPersonnelId
                ? personnelById.get(dragPersonnelId)
                : null;
              const canAssign =
                dragPerson && dragPlanId === plan.id
                  ? validateAssignment(
                      state,
                      plan,
                      [dragPerson],
                      selectedLocationId,
                    ).length === 0
                  : true;
              return (
              <div
                key={plan.id}
                className={`mission-drop${
                  dragPlanId === plan.id
                    ? canAssign
                      ? " is-over"
                      : " is-over-invalid"
                    : ""
                }${selectedPlanId === plan.id ? " is-selected" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragPlanId(plan.id);
                  setHoverPlanId(plan.id);
                }}
                onDragLeave={() => setDragPlanId(null)}
                onDrop={handleDropOnPlan(plan.id)}
                onClick={() => setSelectedPlanId(plan.id)}
                onMouseEnter={() => setHoverPlanId(plan.id)}
                onMouseLeave={() => setHoverPlanId(null)}
              >
                <strong>{plan.name}</strong>
                <div className="meta">{plan.summary}</div>
                <div className="meta">
                  {getPlanHoursLeftLabel(plan)} · {plan.durationHours}h · Success{" "}
                  {Math.round(plan.baseSuccessChance * 100)}%
                </div>
              </div>
            )})}
          </div>
          {selectedPlan || hoverPlanId ? (() => {
            const detailPlan = hoverPlanId
              ? planById.get(hoverPlanId)
              : selectedPlan;
            if (!detailPlan) {
              return <div className="meta">Select an assignment to see details.</div>;
            }
            const detailOffer = hoverPlanId
              ? availableOffers.find((offer) => offer.planId === hoverPlanId)
              : selectedOffer;
            return (
            <div className="meta">
              {detailPlan.name} · {detailPlan.type}
              <div className="meta">
                Duration {detailPlan.durationHours}h · Success{" "}
                {Math.round(detailPlan.baseSuccessChance * 100)}%
              </div>
              {detailOffer ? (
                <div className="meta">
                  Offer expires {detailOffer.expiresAtHours}h
                </div>
              ) : detailPlan.availability?.type === "global" ? (
                <div className="meta">Global availability</div>
              ) : detailPlan.availability?.type === "time" ? (
                <div className="meta">
                  Window {detailPlan.availability.startHours}h to{" "}
                  {detailPlan.availability.endHours}h
                </div>
              ) : null}
              <div className="meta">
                Skills: {detailPlan.requiredSkills.join(", ")}
              </div>
              {detailPlan.requiredMaterials?.length ? (
                <div className="meta">
                  Materials:{" "}
                  {detailPlan.requiredMaterials
                    .map(
                      (req) =>
                        `${req.quantity}x ${req.materialId} (${Math.round(
                          req.consumeChance * 100,
                        )}% consume)`,
                    )
                    .join(", ")}
                </div>
              ) : null}
              {detailPlan.materialRewardTableId ||
              missionTypeConfigByType.get(detailPlan.type)
                ?.defaultMaterialRewardTableId ? (
                <div className="meta">
                  Materials:{" "}
                  {materialRewardTableById
                    .get(
                      detailPlan.materialRewardTableId ??
                        missionTypeConfigByType.get(detailPlan.type)
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
            );
          })() : (
            <div className="meta">Select an assignment to see details.</div>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>All Assignments</h2>
          {activeMissionsAll.length === 0 ? (
            <p>No active missions.</p>
          ) : (
            <ul>
              {activeMissionsAll.map((mission) => (
                <li key={mission.id}>
                  {planById.get(mission.planId)?.name ?? mission.planId} ·{" "}
                  {getLocationLabel(mission.locationId)} · {mission.remainingHours}h
                  left · pers{" "}
                  {mission.assignedPersonnelIds
                    .map((id) => personnelById.get(id)?.name ?? id)
                    .join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Travel Orders</h2>
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
