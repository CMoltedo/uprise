import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  advanceTime,
  assignPersonnelToMission,
  assignTravel,
  getMaterialRewardModifier,
  refreshMissionOffers,
  validateAssignment,
} from "../engine.js";
import type { GameRuntime, GameState, Personnel } from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import { SPEEDS, createHourAccumulator, getHourOfDay, getUniverseDate } from "../time.js";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";
import { SAVE_KEY, parseSave, serializeSave } from "../persistence.js";

const formatResources = (runtime: GameRuntime) =>
  `Cr ${runtime.resources.credits} · Intel ${runtime.resources.intel}`;

export const LocationApp = () => {
  const ADMIN_CURRENT_APPLY_KEY = "uprise-admin-current-apply";
  const readAdminAppliedRuntime = (): GameRuntime | null => {
    const raw = localStorage.getItem(ADMIN_CURRENT_APPLY_KEY);
    if (!raw) {
      return null;
    }
    const parsed = parseSave(raw);
    if (!parsed) {
      localStorage.removeItem(ADMIN_CURRENT_APPLY_KEY);
      return null;
    }
    localStorage.removeItem(ADMIN_CURRENT_APPLY_KEY);
    return parsed;
  };
  const initialScenario = (() => {
    const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
    const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
    const appliedRuntime = readAdminAppliedRuntime();
    if (appliedRuntime) {
      return refreshMissionOffers({ ...scenario, runtime: appliedRuntime });
    }
    return refreshMissionOffers(scenario);
  })();

  const [state, setState] = useState<GameState>(() => initialScenario);
  const data = state.data;
  const runtime = state.runtime;
  const [speedIndex, setSpeedIndex] = useState<number>(2);
  const [mapLevel, setMapLevel] = useState<"galaxy" | "sector" | "planet">(
    "galaxy",
  );
  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    initialScenario.data.sectors[0]?.id ?? "",
  );
  const [selectedPlanetId, setSelectedPlanetId] = useState<string>(
    initialScenario.data.planets[0]?.id ?? "",
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    initialScenario.data.locations[0]?.id ?? "",
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    initialScenario.data.missionPlans[0]?.id ?? "",
  );
  const [travelPersonnelId, setTravelPersonnelId] = useState<string>(
    initialScenario.runtime.personnel[0]?.id ?? "",
  );
  const [travelDestinationId, setTravelDestinationId] = useState<string>(
    initialScenario.data.locations[0]?.id ?? "",
  );
  const [travelHours, setTravelHours] = useState<number>(12);
  const [dragPlanId, setDragPlanId] = useState<string | null>(null);
  const [hoverPlanId, setHoverPlanId] = useState<string | null>(null);
  const [dragPersonnelId, setDragPersonnelId] = useState<string | null>(null);
  const [mapDropLocationId, setMapDropLocationId] = useState<string | null>(null);
  const [showConsoleMenu, setShowConsoleMenu] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [flashPlanId, setFlashPlanId] = useState<string | null>(null);
  const [flashPersonnelId, setFlashPersonnelId] = useState<string | null>(null);
  const [recentlyAssignedPlans, setRecentlyAssignedPlans] = useState<
    Array<{ planId: string; expiresAt: number }>
  >([]);
  const [pendingAssignment, setPendingAssignment] = useState<{
    planId: string;
    personIds: string[];
    locationId: string;
  } | null>(null);
  const [selectedPersonnelIds, setSelectedPersonnelIds] = useState<string[]>([]);
  const [saveMenuMode, setSaveMenuMode] = useState<"save" | "load" | null>(null);
  const [saveSlotsVersion, setSaveSlotsVersion] = useState(0);
  const [mapMode, setMapMode] = useState<"map" | "locations">("map");
  const headerRef = useRef<HTMLElement | null>(null);
  const consolePanelRef = useRef<HTMLDivElement | null>(null);
  const flashPlanTimeoutRef = useRef<number | null>(null);
  const flashPersonnelTimeoutRef = useRef<number | null>(null);

  const locationById = useMemo(
    () => new Map(data.locations.map((location) => [location.id, location])),
    [data.locations],
  );
  const sectorById = useMemo(
    () => new Map(data.sectors.map((sector) => [sector.id, sector])),
    [data.sectors],
  );
  const planetById = useMemo(
    () => new Map(data.planets.map((planet) => [planet.id, planet])),
    [data.planets],
  );
  const planById = useMemo(
    () => new Map(data.missionPlans.map((plan) => [plan.id, plan])),
    [data.missionPlans],
  );
  const personnelById = useMemo(
    () => new Map(runtime.personnel.map((person) => [person.id, person])),
    [runtime.personnel],
  );
  const materialRewardTableById = useMemo(
    () =>
      new Map(data.materialRewardTables.map((table) => [table.id, table])),
    [data.materialRewardTables],
  );
  const missionTypeConfigByType = useMemo(
    () => new Map(data.missionTypeConfigs.map((config) => [config.type, config])),
    [data.missionTypeConfigs],
  );

  const selectedLocation = useMemo(
    () => locationById.get(selectedLocationId) ?? null,
    [locationById, selectedLocationId],
  );
  const personnelByLocationId = useMemo(() => {
    const map = new Map<string, Personnel[]>();
    for (const person of runtime.personnel) {
      const existing = map.get(person.locationId);
      if (existing) {
        existing.push(person);
      } else {
        map.set(person.locationId, [person]);
      }
    }
    return map;
  }, [runtime.personnel]);
  const personnelCountByPlanetId = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of runtime.personnel) {
      const location = locationById.get(person.locationId);
      if (!location) {
        continue;
      }
      map.set(location.planetId, (map.get(location.planetId) ?? 0) + 1);
    }
    return map;
  }, [runtime.personnel, locationById]);
  const personnelCountBySectorId = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of runtime.personnel) {
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
  }, [runtime.personnel, locationById, planetById]);
  const sectorPlanets = useMemo(
    () => data.planets.filter((planet) => planet.sectorId === selectedSectorId),
    [data.planets, selectedSectorId],
  );
  const planetLocations = useMemo(
    () => data.locations.filter((location) => location.planetId === selectedPlanetId),
    [data.locations, selectedPlanetId],
  );
  const locationPersonnel = useMemo(() => {
    if (mapLevel === "galaxy") {
      return runtime.personnel;
    }
    if (mapLevel === "sector") {
      return runtime.personnel.filter((person) => {
        const location = locationById.get(person.locationId);
        if (!location) {
          return false;
        }
        const planet = planetById.get(location.planetId);
        return planet?.sectorId === selectedSectorId;
      });
    }
    if (mapLevel === "planet") {
      return runtime.personnel.filter((person) => {
        const location = locationById.get(person.locationId);
        return location?.planetId === selectedPlanetId;
      });
    }
    return runtime.personnel.filter(
      (person) => person.locationId === selectedLocationId,
    );
  }, [
    mapLevel,
    runtime.personnel,
    selectedLocationId,
    selectedSectorId,
    selectedPlanetId,
    locationById,
    planetById,
  ]);

  const availableOffers = useMemo(
    () =>
      runtime.missionOffers.filter((offer) => offer.locationId === selectedLocationId),
    [runtime.missionOffers, selectedLocationId],
  );
  const offerHoursByPlanId = useMemo(() => {
    const map = new Map<string, number>();
    for (const offer of availableOffers) {
      const hoursLeft = Math.max(0, offer.expiresAtHours - runtime.nowHours);
      map.set(offer.planId, hoursLeft);
    }
    return map;
  }, [availableOffers, runtime.nowHours]);
  const availablePlans = useMemo(() => {
    const plansFromOffers = availableOffers
      .map((offer) => data.missionPlans.find((plan) => plan.id === offer.planId))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

    const globalPlans = data.missionPlans.filter(
      (plan) => plan.availability?.type === "global",
    );
    const timePlans = data.missionPlans.filter(
      (plan) =>
        plan.availability?.type === "time" &&
        runtime.nowHours >= plan.availability.startHours &&
        runtime.nowHours <= plan.availability.endHours,
    );
    return [...plansFromOffers, ...globalPlans, ...timePlans];
  }, [availableOffers, data.missionPlans, runtime.nowHours]);
  const timePlanCount = useMemo(
    () =>
      data.missionPlans.filter(
        (plan) =>
          plan.availability?.type === "time" &&
          runtime.nowHours >= plan.availability.startHours &&
          runtime.nowHours <= plan.availability.endHours,
      ).length,
    [data.missionPlans, runtime.nowHours],
  );
  const missionCountByLocationId = useMemo(() => {
    const map = new Map<string, number>();
    for (const location of data.locations) {
      map.set(location.id, timePlanCount);
    }
    for (const offer of runtime.missionOffers) {
      map.set(offer.locationId, (map.get(offer.locationId) ?? 0) + 1);
    }
    return map;
  }, [data.locations, runtime.missionOffers, timePlanCount]);
  const getPlanSortValue = (plan: typeof availablePlans[number]) => {
    const offerHours = offerHoursByPlanId.get(plan.id);
    if (offerHours !== undefined) {
      return offerHours;
    }
    if (plan.availability?.type === "time") {
      return Math.max(0, plan.availability.endHours - runtime.nowHours);
    }
    if (plan.availability?.type === "global") {
      return -1;
    }
    return Number.POSITIVE_INFINITY;
  };
  const ghostPlans = useMemo(() => {
    const now = Date.now();
    return recentlyAssignedPlans
      .filter((entry) => entry.expiresAt > now)
      .map((entry) => planById.get(entry.planId))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));
  }, [recentlyAssignedPlans, planById]);
  const ghostPlanIds = useMemo(
    () => new Set(recentlyAssignedPlans.map((entry) => entry.planId)),
    [recentlyAssignedPlans],
  );
  const displayPlans = useMemo(() => {
    const existing = new Set(availablePlans.map((plan) => plan.id));
    const extras = ghostPlans.filter((plan) => !existing.has(plan.id));
    return [...availablePlans, ...extras];
  }, [availablePlans, ghostPlans]);
  const sortedAvailablePlans = useMemo(
    () =>
      [...displayPlans].sort((a, b) => {
        const diff = getPlanSortValue(a) - getPlanSortValue(b);
        if (diff !== 0) {
          return diff;
        }
        return a.name.localeCompare(b.name);
      }),
    [displayPlans, offerHoursByPlanId, runtime.nowHours],
  );

  const selectedPlan = useMemo(
    () => data.missionPlans.find((plan) => plan.id === selectedPlanId),
    [data.missionPlans, selectedPlanId],
  );
  const selectedOffer = useMemo(
    () =>
      availableOffers.find((offer) => offer.planId === selectedPlanId) ?? null,
    [availableOffers, selectedPlanId],
  );
  const activeMissions = useMemo(
    () =>
      runtime.missions.filter(
        (mission) =>
          mission.status === "active" && mission.locationId === selectedLocationId,
      ),
    [runtime.missions, selectedLocationId],
  );
  const activeMissionsAll = useMemo(
    () =>
      [...runtime.missions]
        .filter((mission) => mission.status === "active")
        .sort((a, b) => a.remainingHours - b.remainingHours),
    [runtime.missions],
  );
  const activeMissionByPlanId = useMemo(() => {
    const map = new Map<string, typeof runtime.missions[number]>();
    for (const mission of activeMissionsAll) {
      const existing = map.get(mission.planId);
      if (!existing || mission.remainingHours < existing.remainingHours) {
        map.set(mission.planId, mission);
      }
    }
    return map;
  }, [activeMissionsAll]);
  const completingSoonMissions = useMemo(
    () => activeMissionsAll.filter((mission) => mission.remainingHours <= 5),
    [activeMissionsAll],
  );
  const expiringSoonOffers = useMemo(
    () =>
      runtime.missionOffers
        .filter((offer) => offer.expiresAtHours - runtime.nowHours <= 24)
        .sort(
          (a, b) =>
            a.expiresAtHours -
            runtime.nowHours -
            (b.expiresAtHours - runtime.nowHours),
        ),
    [runtime.missionOffers, runtime.nowHours],
  );
  const missionByPersonnelId = useMemo(() => {
    const map = new Map<string, typeof runtime.missions[number]>();
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
  const materialById = useMemo(
    () => new Map(runtime.materials.map((item) => [item.id, item])),
    [runtime.materials],
  );

  const rewardModifier = useMemo(
    () =>
      selectedLocation ? getMaterialRewardModifier(state, selectedLocation.id) : null,
    [selectedLocation, state],
  );

  const timeAccumulatorRef = useRef(
    createHourAccumulator(SPEEDS[2], initialScenario.runtime.nowHours),
  );
  const [toasts, setToasts] = useState<
    Array<{
      id: string;
      parts: Array<
        | { kind: "text"; value: string }
        | { kind: "location"; value: string; locationId: string }
        | { kind: "personnel"; value: string; personnelId: string }
      >;
    }>
  >([]);
  const lastEventIdRef = useRef<string | null>(null);

  const nowDate = getUniverseDate(runtime.nowHours);
  const year = nowDate.getUTCFullYear();
  const month = nowDate.getUTCMonth() + 1;
  const day = nowDate.getUTCDate();
  const hourOfDay = getHourOfDay(runtime.nowHours);
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
  const selectLocationForDetails = (locationId: string) => {
    setSelectedLocationId(locationId);
    const location = locationById.get(locationId);
    if (location) {
      setSelectedPlanetId(location.planetId);
      const planet = planetById.get(location.planetId);
      if (planet) {
        setSelectedSectorId(planet.sectorId);
      }
    }
  };
  const jumpToPersonnel = (personnelId: string) => {
    const person = personnelById.get(personnelId);
    if (!person) {
      return;
    }
    jumpToLocation(person.locationId);
    triggerPersonnelFlash(personnelId);
  };
  const triggerPlanFlash = (planId: string) => {
    if (flashPlanTimeoutRef.current) {
      window.clearTimeout(flashPlanTimeoutRef.current);
      flashPlanTimeoutRef.current = null;
    }
    setFlashPlanId(null);
    window.setTimeout(() => setFlashPlanId(planId), 0);
    flashPlanTimeoutRef.current = window.setTimeout(() => {
      setFlashPlanId(null);
      flashPlanTimeoutRef.current = null;
    }, 1300);
  };
  const triggerPersonnelFlash = (personnelId: string) => {
    if (flashPersonnelTimeoutRef.current) {
      window.clearTimeout(flashPersonnelTimeoutRef.current);
      flashPersonnelTimeoutRef.current = null;
    }
    setFlashPersonnelId(null);
    window.setTimeout(() => setFlashPersonnelId(personnelId), 0);
    flashPersonnelTimeoutRef.current = window.setTimeout(() => {
      setFlashPersonnelId(null);
      flashPersonnelTimeoutRef.current = null;
    }, 1300);
  };
  const confirmAssignment = (
    planId: string,
    personIds: string[],
    locationId: string,
  ) => {
    const personnel = personIds
      .map((id) => personnelById.get(id))
      .filter((person): person is Personnel => Boolean(person));
    const plan = planById.get(planId);
    if (!plan || personnel.length === 0) {
      setPendingAssignment(null);
      return;
    }
    const errors = validateAssignment(state, plan, personnel, locationId);
    if (errors.length > 0) {
      pushToast(errors[0]);
      setPendingAssignment(null);
      return;
    }
    const next = assignPersonnelToMission(state, planId, personIds, locationId);
    setState(next);
    setSelectedPlanId(planId);
    setPendingAssignment(null);
    setSelectedPersonnelIds([]);
    if (plan.availability?.type !== "global") {
      const now = Date.now();
      setRecentlyAssignedPlans((prev) => [
        ...prev.filter((entry) => entry.planId !== planId && entry.expiresAt > now),
        { planId, expiresAt: now + 3000 },
      ]);
    }
  };

  const SAVE_SLOTS = [1, 2, 3] as const;
  const getSlotKey = (slot: number) => `${SAVE_KEY}-slot-${slot}`;
  const readSlotMeta = (slot: number) => {
    const raw = localStorage.getItem(getSlotKey(slot));
    if (!raw) {
      return null;
    }
    try {
      const data = JSON.parse(raw) as {
        app?: string;
        version?: number;
        runtime?: { nowHours?: number };
        state?: { runtime?: { nowHours?: number }; nowHours?: number };
      };
      if (data.app !== "uprise") {
        return null;
      }
      const nowHours =
        data.version === 2
          ? data.runtime?.nowHours ?? 0
          : data.state?.runtime?.nowHours ?? data.state?.nowHours ?? 0;
      const date = getUniverseDate(nowHours);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      return { simStamp: `${year}-${month}-${day} ${hour}h` };
    } catch {
      return null;
    }
  };
  const slotMetas = useMemo(
    () =>
      SAVE_SLOTS.map((slot) => ({
        slot,
        meta: readSlotMeta(slot),
      })),
    [saveSlotsVersion],
  );
  const applyLoadedRuntime = (loaded: GameRuntime) => {
    setState((prev) => ({ ...prev, runtime: loaded }));
    setMapLevel("galaxy");
    setSelectedSectorId(data.sectors[0]?.id ?? "");
    setSelectedPlanetId(data.planets[0]?.id ?? "");
    setSelectedLocationId(data.locations[0]?.id ?? "");
    setSelectedPlanId(data.missionPlans[0]?.id ?? "");
    setTravelPersonnelId(loaded.personnel[0]?.id ?? "");
    setTravelDestinationId(data.locations[0]?.id ?? "");
  };
  const handleSaveSlot = (slot: number) => {
    const payload = serializeSave(runtime);
    localStorage.setItem(getSlotKey(slot), payload);
    setSaveSlotsVersion((prev) => prev + 1);
    pushToast(`Saved to slot ${slot}.`);
    setSaveMenuMode(null);
  };
  const handleLoadSlot = (slot: number) => {
    const raw = localStorage.getItem(getSlotKey(slot));
    if (!raw) {
      pushToast("No save found in that slot.");
      return;
    }
    const loaded = parseSave(raw);
    if (!loaded) {
      pushToast("Save file is invalid.");
      return;
    }
    applyLoadedRuntime(loaded);
    setSaveMenuMode(null);
    pushToast(`Loaded slot ${slot}.`);
  };

  const handleRestart = () => {
    const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
    const scenario = buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
    const refreshed = refreshMissionOffers(scenario);
    setState(refreshed);
    setPendingAssignment(null);
    setSelectedPersonnelIds([]);
    pushToast("Game restarted from baseline.");
  };
  const handleOpenAdmin = () => {
    localStorage.setItem("uprise-admin-current-draft", serializeSave(runtime));
    window.location.hash = "#/admin";
    setShowConsoleMenu(false);
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
      const nextIds = selectedPersonnelIds.includes(personId)
        ? selectedPersonnelIds
        : [personId];
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ personIds: nextIds }),
      );
      event.dataTransfer.setData("text/plain", personId);
      event.dataTransfer.effectAllowed = "move";
      setDragPersonnelId(personId);
      setSelectedPersonnelIds(nextIds);
    };

  const handleDropOnPlan =
    (planId: string) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (
        pendingAssignment &&
        (pendingAssignment.planId !== planId ||
          pendingAssignment.locationId !== selectedLocationId)
      ) {
        return;
      }
      setDragPlanId(null);
      setHoverPlanId(null);
      setDragPersonnelId(null);
      setMapDropLocationId(null);
      const payload = event.dataTransfer.getData("application/json");
      const parsedIds = payload
        ? (() => {
            try {
              const parsed = JSON.parse(payload) as { personIds?: string[] };
              return parsed.personIds ?? [];
            } catch {
              return [];
            }
          })()
        : [];
      const personIds =
        parsedIds.length > 0
          ? parsedIds
          : event.dataTransfer.getData("text/plain")
            ? [event.dataTransfer.getData("text/plain")]
            : [];
      if (personIds.length === 0) {
        return;
      }
      const personnel = personIds
        .map((id) => personnelById.get(id))
        .filter((person): person is Personnel => Boolean(person));
      const plan = planById.get(planId);
      if (!plan || personnel.length === 0) {
        return;
      }
      const errors = validateAssignment(state, plan, personnel, selectedLocationId);
      if (errors.length > 0) {
        pushToast(errors[0]);
        setSelectedPlanId(planId);
        return;
      }
      setSelectedPlanId(planId);
      setPendingAssignment((prev) => {
        if (prev && prev.planId === planId && prev.locationId === selectedLocationId) {
          const merged = new Set([...prev.personIds, ...personIds]);
          return {
            ...prev,
            personIds: Array.from(merged),
          };
        }
        return { planId, personIds, locationId: selectedLocationId };
      });
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
      const hoursLeft = Math.max(0, plan.availability.endHours - runtime.nowHours);
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
    if (locationId === "galaxy") {
      return "Galaxy";
    }
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

  const getPersonnelStatusMeta = (person: Personnel) => {
    if (person.status === "wounded") {
      return { label: "injured", className: "is-injured" };
    }
    if (person.status === "assigned" || person.status === "traveling") {
      return { label: "on mission", className: "is-mission" };
    }
    return { label: "idle", className: "is-idle" };
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

  const focusSector = (sectorId: string) => {
    setSelectedSectorId(sectorId);
    setMapLevel("sector");
    const planet = data.planets.find((item) => item.sectorId === sectorId);
    if (!planet) {
      return;
    }
    setSelectedPlanetId(planet.id);
    const location = data.locations.find((item) => item.planetId === planet.id);
    if (location) {
      setSelectedLocationId(location.id);
    }
  };

  useEffect(() => {
    const speed = SPEEDS[speedIndex] ?? SPEEDS[2];
    setState((prev) => {
      timeAccumulatorRef.current.setSpeed(speed, prev.runtime.nowHours);
      return prev;
    });
    const interval = setInterval(() => {
      setState((prev) => {
        if (isPaused) {
          return prev;
        }
        const hoursToAdvance = timeAccumulatorRef.current.tick(prev.runtime.nowHours);
        return hoursToAdvance > 0 ? advanceTime(prev, hoursToAdvance) : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [speedIndex, isPaused]);

  useEffect(() => {
    const latest = runtime.eventLog[runtime.eventLog.length - 1];
    if (!latest || latest.id === lastEventIdRef.current) {
      return;
    }
    lastEventIdRef.current = latest.id;
    const makeLocationPart = (locationId: string) => ({
      kind: "location" as const,
      value: getLocationLabel(locationId),
      locationId,
    });
    const makePersonnelPart = (personnelId: string) => ({
      kind: "personnel" as const,
      value: personnelById.get(personnelId)?.name ?? personnelId,
      personnelId,
    });
    const parts =
      latest.kind === "mission"
        ? (() => {
            const detail: Array<
              | { kind: "text"; value: string }
              | { kind: "location"; value: string; locationId: string }
              | { kind: "personnel"; value: string; personnelId: string }
            > = [
              {
                kind: "text",
                value: `${latest.success ? "Successful" : "Failed"} mission by `,
              },
            ];
            latest.personnelIds.forEach((id, index) => {
              detail.push(makePersonnelPart(id));
              if (index < latest.personnelIds.length - 1) {
                detail.push({ kind: "text", value: ", " });
              }
            });
            detail.push({ kind: "text", value: " at " });
            detail.push(makeLocationPart(latest.locationId));
            return detail;
          })()
        : latest.status === "started"
          ? ([
              makePersonnelPart(latest.personnelId),
              { kind: "text", value: " departed " },
              makeLocationPart(latest.fromLocationId),
              { kind: "text", value: " for " },
              makeLocationPart(latest.toLocationId),
              { kind: "text", value: ` (${latest.travelHours ?? 0}h)` },
            ] as const)
          : ([
              makePersonnelPart(latest.personnelId),
              { kind: "text", value: " arrived at " },
              makeLocationPart(latest.toLocationId),
              { kind: "text", value: " from " },
              makeLocationPart(latest.fromLocationId),
            ] as const);
    const toast = { id: latest.id, parts: [...parts] };
    setToasts((prev) => [...prev, toast]);
  }, [runtime.eventLog, personnelById, locationById, planetById, sectorById]);

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
    if (recentlyAssignedPlans.length === 0) {
      return;
    }
    const now = Date.now();
    const nextExpiry = Math.min(...recentlyAssignedPlans.map((entry) => entry.expiresAt));
    const timeout = window.setTimeout(() => {
      setRecentlyAssignedPlans((prev) =>
        prev.filter((entry) => entry.expiresAt > Date.now()),
      );
    }, Math.max(0, nextExpiry - now) + 20);
    return () => window.clearTimeout(timeout);
  }, [recentlyAssignedPlans]);

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
    if (!isPaused) {
      return;
    }
    setDialFlashKey((prev) => prev + 1);
    const interval = setInterval(() => {
      setDialFlashKey((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  useEffect(() => {
    if (locationById.has(selectedLocationId)) {
      return;
    }
    setSelectedLocationId(data.locations[0]?.id ?? "");
  }, [locationById, selectedLocationId, data.locations]);

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
                ) : part.kind === "personnel" ? (
                  <button
                    key={`${toast.id}-person-${part.personnelId}-${index}`}
                    type="button"
                    className="toast-agent"
                    onClick={() => jumpToPersonnel(part.personnelId)}
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
      {saveMenuMode ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={saveMenuMode === "save" ? "Save game" : "Load game"}
        >
          <div className="modal-card">
            <div className="modal-header">
              <h3>{saveMenuMode === "save" ? "Save Game" : "Load Game"}</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSaveMenuMode(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {slotMetas.map(({ slot, meta }) => (
                <button
                  key={slot}
                  type="button"
                  className="slot-button"
                  disabled={saveMenuMode === "load" && !meta}
                  onClick={() =>
                    saveMenuMode === "save" ? handleSaveSlot(slot) : handleLoadSlot(slot)
                  }
                >
                  <span>Slot {slot}</span>
                  <span className="meta">
                    {meta?.simStamp ? meta.simStamp : "Empty"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <header className="header" ref={headerRef}>
        <div className="card header-missions">
          <div className="header-missions-header">
            <h2 className="header-missions-title">Imminent Activity</h2>
            <div className="meta header-missions-meta">
              {completingSoonMissions.length} completing · {expiringSoonOffers.length} expiring
            </div>
          </div>
          {completingSoonMissions.length === 0 && expiringSoonOffers.length === 0 ? (
            <p>No assignments finishing soon.</p>
          ) : (
            <ul className="header-missions-list">
              {completingSoonMissions.map((mission) => (
                <li key={mission.id}>
                  {planById.get(mission.planId)?.name ?? mission.planId} ·{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => jumpToLocation(mission.locationId)}
                  >
                    {getLocationLabel(mission.locationId)}
                  </button>{" "}
                  · {mission.remainingHours}h remaining · pers{" "}
                  {mission.assignedPersonnelIds.map((id, index) => (
                    <span key={id}>
                      {index > 0 ? ", " : ""}
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => jumpToPersonnel(id)}
                      >
                        {personnelById.get(id)?.name ?? id}
                      </button>
                    </span>
                  ))}
                </li>
              ))}
              {expiringSoonOffers.map((offer) => (
                <li key={offer.id}>
                  Offer:{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => {
                      jumpToLocation(offer.locationId);
                      setSelectedPlanId(offer.planId);
                      triggerPlanFlash(offer.planId);
                    }}
                  >
                    {planById.get(offer.planId)?.name ?? offer.planId}
                  </button>{" "}
                  ·{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => jumpToLocation(offer.locationId)}
                  >
                    {getLocationLabel(offer.locationId)}
                  </button>{" "}
                  ·{" "}
                  {Math.max(0, Math.ceil(offer.expiresAtHours - runtime.nowHours))}h
                  {" "}left
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card header-resources">
          <div className="header-resources-header">
            <h2 className="header-resources-title">Resources</h2>
            <div className="meta header-resources-meta">
              {formatResources(runtime)}
            </div>
          </div>
          <ul className="header-resources-list">
            {runtime.materials.map((item) => (
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
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMenuMode("save");
                      setShowConsoleMenu(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMenuMode("load");
                      setShowConsoleMenu(false);
                    }}
                  >
                    Load
                  </button>
                  <button type="button" onClick={handleOpenAdmin}>
                    Admin
                  </button>
                  <button type="button" onClick={handleRestart}>
                    Restart
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
                className={`time-dial${isPaused ? " is-paused" : ""}`}
                style={{ ["--dial-fill" as string]: `${hourFill}%` }}
                role="button"
                tabIndex={0}
                aria-label={isPaused ? "Resume time" : "Pause time"}
                onClick={() => setIsPaused((prev) => !prev)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setIsPaused((prev) => !prev);
                  }
                }}
              >
                <div className="time-dial-center" />
                <div className="time-dial-label">{isPaused ? "⏸" : `${hourOfDay}h`}</div>
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
          <div className="map-mode-toggle">
            <button
              type="button"
              className={mapMode === "map" ? "is-active" : ""}
              onClick={() => setMapMode("map")}
            >
              Map
            </button>
            <button
              type="button"
              className={mapMode === "locations" ? "is-active" : ""}
              onClick={() => setMapMode("locations")}
            >
              Locations
            </button>
          </div>
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
        <div className="map-panel-body">
          {mapMode === "map" ? (
            mapLevel === "galaxy" ? (
              <svg className="map-svg map-svg-large" viewBox="0 0 120 120">
              {[
                { x: 5, y: 5 },
                { x: 61, y: 5 },
                { x: 5, y: 61 },
                { x: 61, y: 61 },
              ].map((position, index) => {
                const sector = data.sectors[index];
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
                    onClick={() => focusSector(sector.id)}
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
                      const firstLocation = data.locations.find(
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
            )
          ) : (
            <div className="location-list">
              {[...data.locations]
                .sort((a, b) =>
                  (a.name ?? a.id).localeCompare(b.name ?? b.id),
                )
                .map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    className={location.id === selectedLocationId ? "is-active" : ""}
                    onClick={() => selectLocationForDetails(location.id)}
                  >
                    {getLocationLabel(location.id)}
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className="meta">
          Selected: {getLocationLabel(selectedLocationId)}
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <div className="map-breadcrumbs location-breadcrumbs">
            <button type="button" onClick={() => setMapLevel("galaxy")}>
              Galaxy
            </button>
            {mapLevel !== "galaxy" ? (
              <button
                type="button"
                onClick={() => selectedSectorId && setMapLevel("sector")}
                disabled={!selectedSectorId}
              >
                {sectorById.get(selectedSectorId)?.name ?? "Sector"}
              </button>
            ) : null}
            {mapLevel === "planet" ? (
              <button
                type="button"
                onClick={() => selectedPlanetId && setMapLevel("planet")}
                disabled={!selectedPlanetId}
              >
                {planetById.get(selectedPlanetId)?.name ?? "Planet"}
              </button>
            ) : null}
          </div>
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
                  }${flashPersonnelId === person.id ? " is-flashing" : ""}${
                    selectedPersonnelIds.includes(person.id) ? " is-selected" : ""
                  }`}
                  style={getPersonnelOptionStyle(person)}
                  draggable={person.status === "idle"}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) {
                      setSelectedPersonnelIds((prev) =>
                        prev.includes(person.id)
                          ? prev.filter((id) => id !== person.id)
                          : [...prev, person.id],
                      );
                      return;
                    }
                    setSelectedPersonnelIds([person.id]);
                  }}
                  onDragStart={(event) => {
                    if (person.status !== "idle") {
                      event.preventDefault();
                      return;
                    }
                    handleDragStart(person.id)(event);
                  }}
                  onDragEnd={() => {
                    setDragPlanId(null);
                    setHoverPlanId(null);
                    setDragPersonnelId(null);
                    setMapDropLocationId(null);
                  }}
                >
                  <div className="personnel-header">
                    <strong>{person.name}</strong>
                    <span
                      className={`personnel-status ${getPersonnelStatusMeta(person).className}`}
                    >
                      {getPersonnelStatusMeta(person).label}
                    </span>
                  </div>
                  <div className="meta">
                    {person.skills.join(", ")}
                  </div>
                  <div className="meta">
                    Traits: {person.traits?.join(", ") ?? "none"}
                  </div>
                  <div className="meta">
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => jumpToLocation(person.locationId)}
                    >
                      {getLocationLabel(person.locationId)}
                    </button>
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
          <div className="assignment-details-title">Agent Details</div>
          {selectedPersonnelIds.length > 0 ? (
            (() => {
              const person = personnelById.get(selectedPersonnelIds[0]);
              if (!person) {
                return <div className="meta">Select an agent to see details.</div>;
              }
              const statusMeta = getPersonnelStatusMeta(person);
              const mission = missionByPersonnelId.get(person.id);
              return (
                <div className="meta">
                  <div>
                    {person.name} ·{" "}
                    <span className={`personnel-status ${statusMeta.className}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <div className="meta">Skills: {person.skills.join(", ")}</div>
                  <div className="meta">
                    Traits: {person.traits?.join(", ") ?? "none"}
                  </div>
                  <div className="meta">
                    Location:{" "}
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => jumpToLocation(person.locationId)}
                    >
                      {getLocationLabel(person.locationId)}
                    </button>
                  </div>
                  {mission ? (
                    <div className="meta">
                      Mission:{" "}
                      {planById.get(mission.planId)?.name ?? mission.planId} ·{" "}
                      {mission.remainingHours}h left
                    </div>
                  ) : (
                    <div className="meta">Mission: none</div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="meta">Select an agent to see details.</div>
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
              const activeMission = activeMissionByPlanId.get(plan.id);
              const isGlobalCooldown =
                plan.availability?.type === "global" && Boolean(activeMission);
              const isRecentlyAssigned = ghostPlanIds.has(plan.id);
              const isDisabled = isGlobalCooldown || isRecentlyAssigned;
              const isPending = pendingAssignment?.planId === plan.id;
              const canAssign =
                !isDisabled && dragPerson && dragPlanId === plan.id
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
                }${selectedPlanId === plan.id ? " is-selected" : ""}${
                  flashPlanId === plan.id ? " is-flashing" : ""
                }${isDisabled ? " is-disabled" : ""}${
                  isPending ? " is-pending is-over" : ""
                }`}
                onDragOver={(event) => {
                  if (
                    isDisabled ||
                    (pendingAssignment &&
                      (pendingAssignment.planId !== plan.id ||
                        pendingAssignment.locationId !== selectedLocationId))
                  ) {
                    return;
                  }
                  event.preventDefault();
                  setDragPlanId(plan.id);
                  setHoverPlanId(plan.id);
                }}
                onDragLeave={() => setDragPlanId(null)}
                onDrop={(event) => {
                  if (
                    isDisabled ||
                    (pendingAssignment &&
                      (pendingAssignment.planId !== plan.id ||
                        pendingAssignment.locationId !== selectedLocationId))
                  ) {
                    return;
                  }
                  handleDropOnPlan(plan.id)(event);
                }}
                onClick={() => {
                  if (isDisabled) {
                    return;
                  }
                  setSelectedPlanId(plan.id);
                }}
                onMouseEnter={() => {
                  if (!isDisabled && dragPersonnelId) {
                    setHoverPlanId(plan.id);
                  }
                }}
                onMouseLeave={() => setHoverPlanId(null)}
              >
                <strong>{plan.name}</strong>
                <div className="meta">{plan.summary}</div>
                <div className="meta">
                  {getPlanHoursLeftLabel(plan)} · {plan.durationHours}h · Success{" "}
                  {Math.round(plan.baseSuccessChance * 100)}%
                </div>
                {isGlobalCooldown ? (
                  <div className="meta">
                    Cooldown: {Math.ceil(activeMission?.remainingHours ?? 0)}h left
                  </div>
                ) : null}
                {isPending ? (
                  <div className="mission-confirm">
                    <span className="meta">
                      Assign{" "}
                      {pendingAssignment?.personIds
                        .map((id) => personnelById.get(id)?.name ?? id)
                        .join(", ")}
                      ?
                    </span>
                    <div className="mission-confirm-actions">
                      <button
                        type="button"
                        className="confirm-button"
                        onClick={() => {
                          if (!pendingAssignment) {
                            return;
                          }
                          confirmAssignment(
                            pendingAssignment.planId,
                            pendingAssignment.personIds,
                            pendingAssignment.locationId,
                          );
                        }}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="cancel-button"
                        onClick={() => {
                          setPendingAssignment(null);
                          setSelectedPersonnelIds([]);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )})}
          </div>
          <div className="assignment-details-title">Assignment Details</div>
          {selectedPlan || (dragPersonnelId && hoverPlanId) ? (() => {
            const detailPlanId = dragPersonnelId ? hoverPlanId : selectedPlanId;
            const detailPlan = detailPlanId ? planById.get(detailPlanId) : null;
            if (!detailPlan) {
              return <div className="meta">Select an assignment to see details.</div>;
            }
            const detailOffer = detailPlanId
              ? availableOffers.find((offer) => offer.planId === detailPlanId) ?? null
              : null;
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
              <div className="meta assignment-details-section">Requirements</div>
              <div className="meta assignment-details-item">
                Skills: {detailPlan.requiredSkills.join(", ")}
              </div>
              {detailPlan.requiredMaterials?.length ? (
                <div className="meta assignment-details-item">
                  Materials:
                  <div className="assignment-details-sublist">
                    {detailPlan.requiredMaterials.map((req) => {
                      const available = materialById.get(req.materialId)?.quantity ?? 0;
                      const isMet = available >= req.quantity;
                      return (
                        <div
                          key={req.materialId}
                          className={`meta assignment-details-subitem${
                            isMet ? "" : " requirement-unmet"
                          }`}
                        >
                          {req.quantity}x {req.materialId} (
                          {Math.round(req.consumeChance * 100)}% consume)
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="meta assignment-details-item">Materials: none</div>
              )}
              <div className="meta assignment-details-section">Rewards</div>
              {detailPlan.materialRewardTableId ||
              missionTypeConfigByType.get(detailPlan.type)
                ?.defaultMaterialRewardTableId ? (
                <div className="meta assignment-details-item">
                  Materials:
                  <div className="assignment-details-sublist">
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
                        return (
                          <div key={entry.materialId} className="meta assignment-details-subitem">
                            {entry.quantity}x {entry.materialId} ({chance}%)
                          </div>
                        );
                      }) || <div className="meta assignment-details-subitem">none</div>}
                  </div>
                </div>
              ) : (
                <div className="meta assignment-details-item">Materials: none</div>
              )}
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
              {runtime.personnel.map((person) => (
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
              {data.locations.map((location) => (
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
          {runtime.travel.length > 0 ? (
            <ul>
              {runtime.travel.map((assignment) => (
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
        {runtime.eventLog.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          <ul>
            {runtime.eventLog
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
