import { useEffect, useMemo, useRef, useState, useCallback, type DragEvent } from "react";
import {
  assignPersonnelToMission,
  assignTravel,
  canPersonnelBeAssignedToTrainingPlan,
  getIntelDisplay,
  getLocation,
  getMissionOperationalRisk,
  getMissionSuccessChance,
  getPlanetPopularSupport,
  getTraitsForPerson,
  validateAssignment,
} from "../engine.js";
import type { GameRuntime, GameState, Personnel } from "../models.js";
import { SPEEDS, getHourOfDay, getUniverseDate } from "../time.js";
import { serializeSave } from "../persistence.js";
import { createInitialGameState } from "../game/bootstrap.js";
import { useGameClock } from "../game/useGameClock.js";
import {
  buildIdMap,
  formatResources,
  getLocationLabel as buildLocationLabel,
  getPersonnelOptionStyle as buildPersonnelOptionStyle,
  getPersonnelStatusMeta as buildPersonnelStatusMeta,
  getPlanHoursLeftLabel as buildPlanHoursLeftLabel,
  getTravelBlockReason,
  canPersonnelTravel,
} from "../game/selectors.js";
import {
  SAVE_SLOTS,
  loadSlot,
  readSlotMeta,
  saveSlot,
} from "../game/saveSlots.js";
import { HeaderSection } from "./components/HeaderSection.js";
import { SaveSlotsModal } from "./components/SaveSlotsModal.js";
import { ToastStack, type ToastMessage } from "./components/ToastStack.js";
import { EventDetailModal } from "./components/EventDetailModal.js";

export const App = () => {
  const initialScenario = createInitialGameState();

  const [state, setState] = useState<GameState>(() => initialScenario);
  const data = state.data;
  const runtime = state.runtime;
  const [speedIndex, setSpeedIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(true);
  const [mapMode, setMapMode] = useState<"map" | "locations" | "table">("map");
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(
    null,
  );
  const [expandedSectorIds, setExpandedSectorIds] = useState<string[]>([]);
  const [expandedPlanetIds, setExpandedPlanetIds] = useState<string[]>([]);
  const [mapLevel, setMapLevel] = useState<"galaxy" | "sector" | "planet">(
    "galaxy",
  );

  const [selectedSectorId, setSelectedSectorId] = useState<string>(
    initialScenario.data.sectors[0]?.id ?? "",
  );
  const [selectedPlanetId, setSelectedPlanetId] = useState<string>(
    initialScenario.data.planets[0]?.id ?? "",
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string>(() => {
    const locs = initialScenario.data.locations as { id: string; disabled?: boolean }[];
    return locs?.find((l) => !l.disabled)?.id ?? locs?.[0]?.id ?? "";
  });
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    initialScenario.data.missionPlans[0]?.id ?? "",
  );
  const [selectedPersonnelIds, setSelectedPersonnelIds] = useState<string[]>([]);

  const [travelPersonnelId, setTravelPersonnelId] = useState<string>(
    initialScenario.runtime.personnel[0]?.id ?? "",
  );
  const [travelDestinationId, setTravelDestinationId] = useState<string>(() => {
    const locs = initialScenario.data.locations as { id: string; disabled?: boolean }[];
    return locs?.find((l) => !l.disabled)?.id ?? locs?.[0]?.id ?? "";
  });
  const [travelHours, setTravelHours] = useState<number>(12);

  const [dragPlanId, setDragPlanId] = useState<string | null>(null);
  const [hoverPlanId, setHoverPlanId] = useState<string | null>(null);
  const [dragPersonnelId, setDragPersonnelId] = useState<string | null>(null);
  const [mapDropLocationId, setMapDropLocationId] = useState<string | null>(null);
  const [pendingAssignment, setPendingAssignment] = useState<{
    planId: string;
    personIds: string[];
    locationId: string;
  } | null>(null);
  const [recentlyAssignedPlans, setRecentlyAssignedPlans] = useState<
    Array<{ planId: string; expiresAt: number }>
  >([]);

  const [showConsoleMenu, setShowConsoleMenu] = useState<boolean>(false);
  const [saveMenuMode, setSaveMenuMode] = useState<"save" | "load" | null>(null);
  const [saveSlotsVersion, setSaveSlotsVersion] = useState(0);

  const [flashPlanId, setFlashPlanId] = useState<string | null>(null);
  const [flashPersonnelId, setFlashPersonnelId] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const consolePanelRef = useRef<HTMLDivElement | null>(null);
  const flashPlanTimeoutRef = useRef<number | null>(null);
  const flashPersonnelTimeoutRef = useRef<number | null>(null);

  const locationById = useMemo(() => buildIdMap(data.locations), [data.locations]);
  const enabledLocations = useMemo(
    () => data.locations.filter((loc) => !loc.disabled),
    [data.locations],
  );
  const sectorById = useMemo(() => buildIdMap(data.sectors), [data.sectors]);
  const planetById = useMemo(() => buildIdMap(data.planets), [data.planets]);
  const planById = useMemo(() => buildIdMap(data.missionPlans), [data.missionPlans]);
  const personnelById = useMemo(
    () => buildIdMap(runtime.personnel),
    [runtime.personnel],
  );

  const selectedLocation = useMemo(
    () => locationById.get(selectedLocationId) ?? null,
    [locationById, selectedLocationId],
  );
  const formatIntel = (
    locationId: string,
    key:
      | "customsScrutiny"
      | "patrolFrequency"
      | "garrisonStrength"
      | "resistance"
      | "healthcareFacilities"
      | "techLevel"
      | "populationDensity"
      | "popularSupport",
  ) => {
    const d = getIntelDisplay(state, locationId, key);
    if (d.status === "unknown") return "?";
    const loc = getLocation(state, locationId);
    const value = loc?.attributes[key];
    if (typeof value !== "number") return "?";
    return `${value}${d.status === "stale" ? " (stale)" : ""}`;
  };
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
    () =>
      data.locations.filter(
        (location) =>
          location.planetId === selectedPlanetId && !location.disabled,
      ),
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
  const getLocationLabel = (locationId: string) =>
    buildLocationLabel(locationId, locationById, planetById, sectorById);
  const formatRoleLabel = (roleId: string) =>
    roleId.charAt(0).toUpperCase() + roleId.slice(1);
  const LOCATION_ATTR_LABELS: Record<string, string> = {
    resistance: "Resistance",
    healthcareFacilities: "Healthcare",
    techLevel: "Tech level",
    populationDensity: "Population density",
    customsScrutiny: "Customs",
    patrolFrequency: "Patrols",
    garrisonStrength: "Garrison",
    popularSupport: "Popular support",
  };
  const formatLocationAttributes = (attrs: Record<string, number> | undefined) =>
    attrs && Object.keys(attrs).length > 0
      ? Object.entries(attrs)
          .map(
            ([key, delta]) =>
              `${LOCATION_ATTR_LABELS[key] ?? key} ${delta >= 0 ? "+" : ""}${delta}`,
          )
          .join(", ")
      : null;
  const formatRolesWithLevel = (person: Personnel) =>
    person.roles?.length
      ? person.roles
          .map(
            (r) =>
              `${formatRoleLabel(r)} (${person.roleLevels?.[r] ?? 1})`,
          )
          .join(", ")
      : "none";
  const getPlanHoursLeftLabel = (plan: typeof availablePlans[number]) =>
    buildPlanHoursLeftLabel(plan, offerHoursByPlanId, runtime.nowHours);
  const getPersonnelStatusMeta = (person: Personnel) => buildPersonnelStatusMeta(person);
  const getPersonnelOptionStyle = (person: Personnel) =>
    buildPersonnelOptionStyle(person);
  const availablePlans = useMemo(() => {
    const plansFromOffers = availableOffers
      .map((offer) => data.missionPlans.find((plan) => plan.id === offer.planId))
      .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

    const globalPlans = data.missionPlans.filter(
      (plan) => plan.availability?.type === "global",
    );
    const hasCaptured = runtime.personnel.some((p) => p.status === "captured");
    const hasMia = runtime.personnel.some((p) => p.status === "mia");
    const crisisPlans = globalPlans.filter(
      (plan) =>
        (plan.type !== "rescue" && plan.type !== "search") ||
        (plan.type === "rescue" && hasCaptured) ||
        (plan.type === "search" && hasMia),
    );
    const timePlans = data.missionPlans.filter(
      (plan) =>
        plan.availability?.type === "time" &&
        runtime.nowHours >= plan.availability.startHours &&
        runtime.nowHours <= plan.availability.endHours,
    );
    return [...plansFromOffers, ...crisisPlans, ...timePlans];
  }, [availableOffers, data.missionPlans, runtime.nowHours, runtime.personnel]);
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
  const missionsByLocationId = useMemo(() => {
    const map = new Map<string, typeof runtime.missions[number][]>();
    for (const mission of runtime.missions) {
      if (mission.status !== "active") continue;
      const list = map.get(mission.locationId) ?? [];
      list.push(mission);
      map.set(mission.locationId, list);
    }
    return map;
  }, [runtime.missions]);
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
  const personnelEligibleForSelectedPlan = useMemo(() => {
    if (!selectedPlan) return new Set<string>();
    const eligible = new Set<string>();
    for (const person of locationPersonnel) {
      if (person.status === "killed") continue;
      if (validateAssignment(state, selectedPlan, [person], selectedLocationId).length === 0) {
        eligible.add(person.id);
      }
    }
    return eligible;
  }, [state, selectedPlan, selectedLocationId, locationPersonnel]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const lastEventIdRef = useRef<string | null>(null);
  const [eventDetailEventId, setEventDetailEventId] = useState<string | null>(null);
  const pausedForEventModalRef = useRef(false);

  const openEventDetail = useCallback((id: string) => {
    setEventDetailEventId(id);
    setIsPaused((prev) => {
      if (!prev) {
        pausedForEventModalRef.current = true;
        return true;
      }
      return prev;
    });
  }, []);
  const closeEventDetail = useCallback(() => {
    setEventDetailEventId(null);
    if (pausedForEventModalRef.current) {
      pausedForEventModalRef.current = false;
      setIsPaused(false);
    }
  }, []);

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
    const firstEnabled = data.locations.find((l) => !l.disabled)?.id ?? data.locations[0]?.id ?? "";
    setSelectedLocationId(firstEnabled);
    setSelectedPlanId(data.missionPlans[0]?.id ?? "");
    setTravelPersonnelId(loaded.personnel[0]?.id ?? "");
    setTravelDestinationId(firstEnabled);
  };
  const handleSaveSlot = (slot: number) => {
    saveSlot(slot, runtime);
    setSaveSlotsVersion((prev) => prev + 1);
    pushToast(`Saved to slot ${slot}.`);
    setSaveMenuMode(null);
  };
  const handleLoadSlot = (slot: number) => {
    const result = loadSlot(slot);
    if (result.status === "missing") {
      pushToast("No save found in that slot.");
      return;
    }
    if (result.status === "invalid") {
      pushToast("Save file is invalid.");
      return;
    }
    if (result.status === "ok") {
      applyLoadedRuntime(result.runtime);
    }
    setSaveMenuMode(null);
    pushToast(`Loaded slot ${slot}.`);
  };

  const handleRestart = () => {
    const refreshed = createInitialGameState();
    setState(refreshed);
    setPendingAssignment(null);
    setSelectedPersonnelIds([]);
    const firstEnabled = refreshed.data.locations.find((l) => !l.disabled)?.id ?? refreshed.data.locations[0]?.id ?? "";
    setSelectedLocationId(firstEnabled);
    setTravelDestinationId(firstEnabled);
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

  useGameClock({
    initialHours: initialScenario.runtime.nowHours,
    speedIndex,
    isPaused,
    setState,
  });

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
            if (latest.intelReport) {
              detail.push({ kind: "text", value: ` — ${latest.intelReport.summary}` });
            }
            if (latest.roleGained?.length) {
              detail.push({ kind: "text", value: " — " });
              latest.roleGained.forEach((g, i) => {
                detail.push(makePersonnelPart(g.personnelId));
                detail.push({
                  kind: "text",
                  value: ` gained ${formatRoleLabel(g.roleId)}`,
                });
                if (i < latest.roleGained!.length - 1) {
                  detail.push({ kind: "text", value: "; " });
                }
              });
            }
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
    const shouldOpenDetail =
      latest.kind === "mission" ||
      (latest.kind === "travel" && latest.status === "arrived");
    if (shouldOpenDetail) {
      setEventDetailEventId(latest.id);
      setIsPaused((prev) => {
        if (!prev) {
          pausedForEventModalRef.current = true;
          return true;
        }
        return prev;
      });
    }
  }, [runtime.eventLog, personnelById, locationById, planetById, sectorById, formatRoleLabel]);

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
    const isEnabled = enabledLocations.some((l) => l.id === selectedLocationId);
    if (isEnabled || enabledLocations.length === 0) {
      return;
    }
    setSelectedLocationId(enabledLocations[0]?.id ?? "");
  }, [enabledLocations, selectedLocationId]);

  useEffect(() => {
    const travelEnabled = enabledLocations.some((l) => l.id === travelDestinationId);
    if (travelEnabled || enabledLocations.length === 0) return;
    setTravelDestinationId(enabledLocations[0]?.id ?? "");
  }, [enabledLocations, travelDestinationId]);

  useEffect(() => {
    if (!travelPersonnelId) return;
    const person = personnelById.get(travelPersonnelId);
    if (!person || canPersonnelTravel(person)) return;
    const firstIdle = runtime.personnel.find((p) => canPersonnelTravel(p))?.id;
    setTravelPersonnelId(firstIdle ?? "");
  }, [personnelById, runtime.personnel, travelPersonnelId]);

  useEffect(() => {
    if (mapMode === "locations") {
      setExpandedLocationId(null);
      setExpandedSectorIds([]);
      setExpandedPlanetIds([]);
    }
  }, [mapMode]);

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
      if (mapLevel !== "sector") {
        setSelectedSectorId(planet.sectorId);
      }
    }
  }, [locationById, planetById, selectedLocationId, selectedPlanetId, selectedSectorId, mapLevel]);

  return (
    <div className="page">
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))}
        onLocationClick={jumpToLocation}
        onPersonnelClick={jumpToPersonnel}
        onToastClick={(id) => openEventDetail(id)}
      />
      {eventDetailEventId ? (
        <EventDetailModal
          event={runtime.eventLog.find((e) => e.id === eventDetailEventId) ?? null}
          gameState={state}
          getLocationLabel={getLocationLabel}
          onClose={closeEventDetail}
          onLocationClick={jumpToLocation}
          onPersonnelClick={jumpToPersonnel}
        />
      ) : null}
      {saveMenuMode ? (
        <SaveSlotsModal
          mode={saveMenuMode}
          slotMetas={slotMetas}
          onClose={() => setSaveMenuMode(null)}
          onSaveSlot={handleSaveSlot}
          onLoadSlot={handleLoadSlot}
        />
      ) : null}
      <HeaderSection
        headerRef={headerRef}
        consolePanelRef={consolePanelRef}
        completingSoonMissions={completingSoonMissions}
        expiringSoonOffers={expiringSoonOffers}
        planById={planById}
        personnelById={personnelById}
        getLocationLabel={getLocationLabel}
        onLocationClick={jumpToLocation}
        onOfferClick={(offer) => {
          jumpToLocation(offer.locationId);
          setSelectedPlanId(offer.planId);
          triggerPlanFlash(offer.planId);
        }}
        onPersonnelClick={jumpToPersonnel}
        showConsoleMenu={showConsoleMenu}
        onToggleConsoleMenu={() => setShowConsoleMenu((prev) => !prev)}
        onOpenSaveMenu={() => {
          setSaveMenuMode("save");
          setShowConsoleMenu(false);
        }}
        onOpenLoadMenu={() => {
          setSaveMenuMode("load");
          setShowConsoleMenu(false);
        }}
        onOpenAdmin={handleOpenAdmin}
        onRestart={handleRestart}
        speedLabel={SPEEDS[speedIndex]?.label ?? "Normal"}
        onTogglePause={() => setIsPaused((prev) => !prev)}
        isPaused={isPaused}
        hourFill={hourFill}
        hourOfDay={hourOfDay}
        year={year}
        month={month}
        day={day}
        yearFlashKey={yearFlashKey}
        monthFlashKey={monthFlashKey}
        dayFlashKey={dayFlashKey}
        dialFlashKey={dialFlashKey}
        onSlower={() => setSpeedIndex((prev) => Math.max(0, prev - 1))}
        onFaster={() => setSpeedIndex((prev) => Math.min(SPEEDS.length - 1, prev + 1))}
        resourcesText={formatResources(runtime)}
        materials={runtime.materials}
        nowHours={runtime.nowHours}
      />

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
            <button
              type="button"
              className={mapMode === "table" ? "is-active" : ""}
              onClick={() => setMapMode("table")}
            >
              Table
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
          {mapMode === "table" ? (
            <div className="map-table-wrap">
              <table className="map-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th>Planet</th>
                    <th>Location</th>
                    <th>Enabled</th>
                    {(
                      [
                        "resistance",
                        "healthcareFacilities",
                        "techLevel",
                        "populationDensity",
                        "customsScrutiny",
                        "patrolFrequency",
                        "garrisonStrength",
                        "popularSupport",
                      ] as const
                    ).map((key) => (
                      <th key={key}>{LOCATION_ATTR_LABELS[key] ?? key}</th>
                    ))}
                    <th>Agents</th>
                    <th>Missions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.locations]
                    .sort((a, b) => {
                      const aEnabled = !a.disabled ? 1 : 0;
                      const bEnabled = !b.disabled ? 1 : 0;
                      if (aEnabled !== bEnabled) return bEnabled - aEnabled;
                      const aPlanet = planetById.get(a.planetId)?.name ?? a.planetId;
                      const bPlanet = planetById.get(b.planetId)?.name ?? b.planetId;
                      const sectorCmp = aPlanet.localeCompare(bPlanet);
                      if (sectorCmp !== 0) return sectorCmp;
                      return (a.name ?? a.id).localeCompare(b.name ?? b.id);
                    })
                    .map((location) => {
                      const planet = planetById.get(location.planetId);
                      const sector = planet
                        ? sectorById.get(planet.sectorId)
                        : null;
                      const agents = personnelByLocationId.get(location.id) ?? [];
                      const missions = missionsByLocationId.get(location.id) ?? [];
                      return (
                        <tr key={location.id}>
                          <td>{sector?.name ?? "—"}</td>
                          <td>{planet?.name ?? location.planetId ?? "—"}</td>
                          <td>{location.name}</td>
                          <td>{location.disabled ? "Disabled" : "Enabled"}</td>
                          {(
                            [
                              "resistance",
                              "healthcareFacilities",
                              "techLevel",
                              "populationDensity",
                              "customsScrutiny",
                              "patrolFrequency",
                              "garrisonStrength",
                              "popularSupport",
                            ] as const
                          ).map((key) => (
                            <td key={key}>
                              {location.attributes[key] ?? "—"}
                            </td>
                          ))}
                          <td>
                            {agents.length === 0
                              ? "—"
                              : agents.map((p) => p.name).join(", ")}
                          </td>
                          <td>
                            {missions.length === 0
                              ? "—"
                              : missions
                                  .map((m) => {
                                    const plan = planById.get(m.planId);
                                    const name = plan?.name ?? m.planId ?? "Unknown plan";
                                    return `${name} (${Math.ceil(m.remainingHours)}h)`;
                                  })
                                  .join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : mapMode === "map" ? (
            mapLevel === "galaxy" ? (
              <svg className="map-svg map-svg-large" viewBox="0 0 120 120">
              {[
                { x: 5, y: 5 },
                { x: 61, y: 5 },
                { x: 5, y: 61 },
                { x: 61, y: 61 },
              ].map((position, index) => {
                const sectorBySlot =
                  index === 0
                    ? data.sectors.find((s) => s.id === "core-sector")
                    : index === 1
                      ? data.sectors.find((s) => s.id === "rim-sector")
                      : undefined;
                const sector = sectorBySlot ?? data.sectors[index];
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
                        (location) =>
                          location.planetId === planet.id && !location.disabled,
                      ) ?? data.locations.find(
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
                    {personnelByLocationId.get(location.id)?.length ?? 0} agents
                  </text>
                </g>
              )})}
            </svg>
            )
          ) : (
            <div className="location-list">
              <div className="location-tree-toolbar">
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => {
                    const allSectorIds = data.sectors.map((sector) => sector.id);
                    const allPlanetIds = data.planets.map((planet) => planet.id);
                    const shouldCollapseAll =
                      expandedSectorIds.length === allSectorIds.length &&
                      expandedPlanetIds.length === allPlanetIds.length;
                    setExpandedSectorIds(shouldCollapseAll ? [] : allSectorIds);
                    setExpandedPlanetIds(shouldCollapseAll ? [] : allPlanetIds);
                  }}
                >
                  {expandedSectorIds.length === data.sectors.length &&
                  expandedPlanetIds.length === data.planets.length
                    ? "Collapse all"
                    : "Expand all"}
                </button>
              </div>
              <div className="location-tree">
                {data.sectors.map((sector) => {
                  const isSectorExpanded = expandedSectorIds.includes(sector.id);
                  const sectorPlanets = data.planets.filter(
                    (planet) => planet.sectorId === sector.id,
                  );
                  return (
                    <div key={sector.id} className="location-tree-node">
                      <div className="location-tree-row">
                        <button
                          type="button"
                          className="location-tree-toggle"
                          aria-label={isSectorExpanded ? "Collapse sector" : "Expand sector"}
                          onClick={() =>
                            setExpandedSectorIds((prev) =>
                              prev.includes(sector.id)
                                ? prev.filter((id) => id !== sector.id)
                                : [...prev, sector.id],
                            )
                          }
                        >
                          {isSectorExpanded ? "▾" : "▸"}
                        </button>
                        <button
                          type="button"
                          className={`location-tree-label${
                            sector.id === selectedSectorId ? " is-active" : ""
                          }`}
                          onClick={() => {
                            setSelectedSectorId(sector.id);
                            setExpandedSectorIds((prev) =>
                              prev.includes(sector.id) ? prev : [...prev, sector.id],
                            );
                          }}
                        >
                          {sector.name}
                        </button>
                      </div>
                      {isSectorExpanded ? (
                        <div className="location-tree-details">
                          <div className="meta">Tags: {sector.tags?.join(", ") ?? "none"}</div>
                          <div className="meta">Planets: {sectorPlanets.length}</div>
                          <div className="location-tree-children">
                            {sectorPlanets.map((planet) => {
                              const isPlanetExpanded = expandedPlanetIds.includes(planet.id);
                              const planetLocations = data.locations.filter(
                                (location) =>
                                  location.planetId === planet.id && !location.disabled,
                              );
                              return (
                                <div key={planet.id} className="location-tree-node">
                                  <div className="location-tree-row">
                                    <button
                                      type="button"
                                      className="location-tree-toggle"
                                      aria-label={
                                        isPlanetExpanded
                                          ? "Collapse planet"
                                          : "Expand planet"
                                      }
                                      onClick={() =>
                                        setExpandedPlanetIds((prev) =>
                                          prev.includes(planet.id)
                                            ? prev.filter((id) => id !== planet.id)
                                            : [...prev, planet.id],
                                        )
                                      }
                                    >
                                      {isPlanetExpanded ? "▾" : "▸"}
                                    </button>
                                    <button
                                      type="button"
                                      className={`location-tree-label${
                                        planet.id === selectedPlanetId ? " is-active" : ""
                                      }`}
                                      onClick={() => {
                                        setSelectedPlanetId(planet.id);
                                        setSelectedSectorId(planet.sectorId);
                                        setExpandedPlanetIds((prev) =>
                                          prev.includes(planet.id)
                                            ? prev
                                            : [...prev, planet.id],
                                        );
                                      }}
                                    >
                                      {planet.name}
                                    </button>
                                  </div>
                                  {isPlanetExpanded ? (
                                    <div className="location-tree-details">
                                      <div className="meta">
                                        Tags: {planet.tags?.join(", ") ?? "none"}
                                      </div>
                                      <div className="meta">
                                        Position: {planet.position.x}, {planet.position.y}
                                      </div>
                                      <div className="meta">
                                        Planetary popular support:{" "}
                                        {getPlanetPopularSupport(state, planet.id)}
                                      </div>
                                      <div className="meta">
                                        Locations: {planetLocations.length}
                                      </div>
                                      <div className="location-tree-children">
                                        {planetLocations
                                          .slice()
                                          .sort((a, b) =>
                                            (a.name ?? a.id).localeCompare(b.name ?? b.id),
                                          )
                                          .map((location) => {
                                            const isExpanded =
                                              expandedLocationId === location.id;
                                            return (
                                              <div
                                                key={location.id}
                                                className="location-tree-node"
                                              >
                                                <div className="location-tree-row">
                                                  <button
                                                    type="button"
                                                    className={`location-tree-label${
                                                      location.id === selectedLocationId
                                                        ? " is-active"
                                                        : ""
                                                    }`}
                                                    onClick={() => {
                                                      selectLocationForDetails(location.id);
                                                      setExpandedLocationId((prev) =>
                                                        prev === location.id ? null : location.id,
                                                      );
                                                    }}
                                                  >
                                                    {location.name}
                                                  </button>
                                                </div>
                                                {isExpanded ? (
                                                  <div className="location-tree-details">
                                                    <div className="meta">
                                                      Resistance {formatIntel(location.id, "resistance")}
                                                    </div>
                                                    <div className="meta">
                                                      Tech {formatIntel(location.id, "techLevel")}
                                                    </div>
                                                    <div className="meta">
                                                      Population {formatIntel(location.id, "populationDensity")}
                                                    </div>
                                                    <div className="meta">
                                                      Popular support {formatIntel(location.id, "popularSupport")}
                                                    </div>
                                                    <div className="meta">
                                                      Customs {formatIntel(location.id, "customsScrutiny")}
                                                    </div>
                                                    <div className="meta">
                                                      Patrols {formatIntel(location.id, "patrolFrequency")}
                                                    </div>
                                                    <div className="meta">
                                                      Garrison {formatIntel(location.id, "garrisonStrength")}
                                                    </div>
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
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
                Resistance {formatIntel(selectedLocation.id, "resistance")} · Tech{" "}
                {formatIntel(selectedLocation.id, "techLevel")} · Population{" "}
                {formatIntel(selectedLocation.id, "populationDensity")} · Popular support{" "}
                {formatIntel(selectedLocation.id, "popularSupport")}
              </div>
              <div className="meta">
                Customs {formatIntel(selectedLocation.id, "customsScrutiny")} · Patrols{" "}
                {formatIntel(selectedLocation.id, "patrolFrequency")} · Garrison{" "}
                {formatIntel(selectedLocation.id, "garrisonStrength")}
              </div>
              {selectedLocation.planetId ? (
                <div className="meta">
                  Planetary popular support:{" "}
                  {getPlanetPopularSupport(state, selectedLocation.planetId)}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="meta">Select a location to see details.</div>
          )}
          <div className="meta">Personnel in view: {locationPersonnel.length}</div>
          {locationPersonnel.length === 0 ? (
            <p>No personnel at this location.</p>
          ) : (
            <div className="personnel-cards">
              {locationPersonnel.map((person) => {
                const contextPlanId = dragPersonnelId ? hoverPlanId : selectedPlanId;
                const contextPlan = contextPlanId ? planById.get(contextPlanId) : null;
                const cannotTrainForThisPlan =
                  contextPlan &&
                  contextPlan.type === "training" &&
                  !canPersonnelBeAssignedToTrainingPlan(person, contextPlan);
                const canDragForContext =
                  (person.status === "idle" && !cannotTrainForThisPlan) ||
                  (person.status === "wounded" && contextPlan?.type === "recovery");
                return (
                <div
                  key={person.id}
                  className={`personnel-card${
                    person.status === "wounded" ||
                    person.status === "captured" ||
                    person.status === "mia" ||
                    person.status === "killed" ||
                    person.status === "assigned" ||
                    person.status === "traveling"
                      ? " is-unavailable"
                      : ""
                  }${flashPersonnelId === person.id ? " is-flashing" : ""}${
                    selectedPersonnelIds.includes(person.id)
                      ? (person.status === "wounded" ||
                        person.status === "captured" ||
                        person.status === "mia" ||
                        person.status === "killed" ||
                        person.status === "assigned" ||
                        person.status === "traveling" ||
                        person.status === "resting")
                        ? " is-selected-unavailable"
                        : " is-selected"
                      : ""
                  }${cannotTrainForThisPlan ? " cannot-train-new-role" : ""}${
                    selectedPlan && personnelEligibleForSelectedPlan.has(person.id)
                      ? " can-assign-to-mission"
                      : ""
                  }`}
                  style={getPersonnelOptionStyle(person)}
                  draggable={canDragForContext}
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
                    if (!canDragForContext) {
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
                    {formatRolesWithLevel(person)}
                  </div>
                  <div className="meta">
                    Traits: {getTraitsForPerson(person).join(", ") || "none"}
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
                  {person.status === "captured" && person.capturedLocationId ? (
                    <div className="meta">
                      Held at:{" "}
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => jumpToLocation(person.capturedLocationId!)}
                      >
                        {getLocationLabel(person.capturedLocationId)}
                      </button>
                    </div>
                  ) : null}
                  {person.status === "mia" && person.miaLocationId ? (
                    <div className="meta">
                      Last seen:{" "}
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => jumpToLocation(person.miaLocationId!)}
                      >
                        {getLocationLabel(person.miaLocationId)}
                      </button>
                    </div>
                  ) : null}
                  {missionByPersonnelId.get(person.id) ? (
                    <div className="meta">
                      Mission:{" "}
                      {planById.get(missionByPersonnelId.get(person.id)!.planId)?.name ??
                        missionByPersonnelId.get(person.id)!.planId}{" "}
                      · {missionByPersonnelId.get(person.id)!.remainingHours}h left
                    </div>
                  ) : null}
                </div>
              );
              })}
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
                  <div className="meta">Roles: {formatRolesWithLevel(person)}</div>
                  <div className="meta">
                    Traits: {getTraitsForPerson(person).join(", ") || "none"}
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
              const pendingPersonnel = isPending
                ? pendingAssignment?.personIds
                    .map((id) => personnelById.get(id))
                    .filter((person): person is Personnel => Boolean(person))
                : [];
              const pendingSuccessInfo =
                isPending && pendingPersonnel.length > 0
                  ? getMissionSuccessChance(plan, pendingPersonnel)
                  : null;
              const pendingRisk =
                isPending &&
                pendingPersonnel.length > 0 &&
                selectedLocationId &&
                selectedLocationId !== "galaxy" &&
                plan.type !== "recovery"
                  ? getMissionOperationalRisk(
                      state,
                      plan,
                      selectedLocationId,
                      pendingPersonnel,
                    )
                  : null;
              const baseSuccessPercent = Math.round(plan.baseSuccessChance * 100);
              const pendingSuccessPercent = pendingSuccessInfo
                ? Math.round(pendingSuccessInfo.chance * 100)
                : null;
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
                  Required roles:{" "}
                  {plan.requiredRoles?.length
                    ? plan.requiredRoles.map(formatRoleLabel).join(", ")
                    : "None"}
                </div>
                <div className="meta">
                  {getPlanHoursLeftLabel(plan)} · {plan.durationHours}h · Success{" "}
                  {baseSuccessPercent}%
                  {pendingSuccessPercent !== null &&
                  pendingSuccessPercent !== baseSuccessPercent
                    ? ` → ${pendingSuccessPercent}%`
                    : ""}
                </div>
                {pendingRisk !== null ? (
                  <div className="meta">
                    Risk: {Math.round(pendingRisk * 100)}%
                  </div>
                ) : null}
                {isGlobalCooldown ? (
                  <div className="meta">
                    Cooldown: {Math.ceil(activeMission?.remainingHours ?? 0)}h left
                  </div>
                ) : null}
                {pendingSuccessInfo ? (
                  <>
                    <div className="meta">
                      Traits:{" "}
                      <span
                        className={`success-modifier${
                          pendingSuccessInfo.traitModifier.bonus
                            ? " is-positive"
                            : " is-neutral"
                        }`}
                      >
                        +{Math.round(pendingSuccessInfo.traitModifier.bonus * 100)}%
                      </span>
                      {pendingSuccessInfo.traitModifier.bonuses.length
                        ? ` (${pendingSuccessInfo.traitModifier.bonuses.join(", ")})`
                        : ""}
                      {" · "}
                      <span
                        className={`success-modifier${
                          pendingSuccessInfo.traitModifier.penalty
                            ? " is-negative"
                            : " is-neutral"
                        }`}
                      >
                        -{Math.round(pendingSuccessInfo.traitModifier.penalty * 100)}%
                      </span>
                      {pendingSuccessInfo.traitModifier.penalties.length
                        ? ` (${pendingSuccessInfo.traitModifier.penalties.join(", ")})`
                        : ""}
                    </div>
                    <div className="meta">
                      Roles:{" "}
                      <span
                        className={`success-modifier${
                          pendingSuccessInfo.roleModifier.bonus
                            ? " is-positive"
                            : " is-neutral"
                        }`}
                      >
                        +{Math.round(pendingSuccessInfo.roleModifier.bonus * 100)}%
                      </span>
                      {pendingSuccessInfo.roleModifier.bonuses.length
                        ? ` (${pendingSuccessInfo.roleModifier.bonuses.join(", ")})`
                        : ""}
                      {" · "}
                      <span
                        className={`success-modifier${
                          pendingSuccessInfo.roleModifier.penalty
                            ? " is-negative"
                            : " is-neutral"
                        }`}
                      >
                        -{Math.round(pendingSuccessInfo.roleModifier.penalty * 100)}%
                      </span>
                      {pendingSuccessInfo.roleModifier.penalties.length
                        ? ` (${pendingSuccessInfo.roleModifier.penalties.join(", ")})`
                        : ""}
                    </div>
                  </>
                ) : null}
                {isPending ? (
                  <div className="mission-confirm">
                    <div className="meta">
                      Assign:
                      <div className="mission-confirm-people">
                        {pendingAssignment?.personIds.map((id) => {
                          const person = personnelById.get(id);
                          const label = person?.name ?? id;
                          return (
                            <div key={id} className="mission-confirm-pill">
                              <button
                                type="button"
                                className="mission-confirm-pill-button"
                                onClick={() => {
                                  setSelectedPersonnelIds([id]);
                                  triggerPersonnelFlash(id);
                                }}
                              >
                                {label}
                              </button>
                              <button
                                type="button"
                                className="mission-confirm-remove"
                                aria-label={`Remove ${label}`}
                                onClick={() => {
                                  setPendingAssignment((prev) => {
                                    if (!prev) {
                                      return prev;
                                    }
                                    const nextIds = prev.personIds.filter(
                                      (personId) => personId !== id,
                                    );
                                    if (nextIds.length === 0) {
                                      setSelectedPersonnelIds([]);
                                      return null;
                                    }
                                    setSelectedPersonnelIds(nextIds);
                                    return { ...prev, personIds: nextIds };
                                  });
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
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
                Roles: {detailPlan.requiredRoles.join(", ")}
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
              {detailPlan.rewards?.currency ? (
                <div className="meta assignment-details-item">
                  Currency:
                  <div className="assignment-details-sublist">
                    {[
                      ["credits", detailPlan.rewards.currency.credits],
                      ["intel", detailPlan.rewards.currency.intel],
                    ]
                      .filter(([, value]) => value !== undefined)
                      .map(([label, value]) => (
                        <div key={label} className="meta assignment-details-subitem">
                          {label}: {value}
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="meta assignment-details-item">Currency: none</div>
              )}
              {detailPlan.rewards?.items?.length ? (
                <div className="meta assignment-details-item">
                  Materials:
                  <div className="assignment-details-sublist">
                    {detailPlan.rewards.items.map((entry) => (
                      <div key={entry.materialId} className="meta assignment-details-subitem">
                        {entry.quantity}x {entry.materialId}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="meta assignment-details-item">Materials: none</div>
              )}
              {detailPlan.rewards?.effects?.length ? (
                <div className="meta assignment-details-item">
                  Other:
                  <div className="assignment-details-sublist">
                    {detailPlan.rewards.effects.map((effect, index) => (
                      <div key={`${effect.type}-${index}`} className="meta assignment-details-subitem">
                        {effect.type}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {formatLocationAttributes(detailPlan.rewards?.locationAttributes) ? (
                <div className="meta assignment-details-item">
                  On success (location): {formatLocationAttributes(detailPlan.rewards?.locationAttributes)}
                </div>
              ) : null}
              {formatLocationAttributes(detailPlan.penalties?.locationAttributes) ? (
                <div className="meta assignment-details-item">
                  On failure (location): {formatLocationAttributes(detailPlan.penalties?.locationAttributes)}
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
              {runtime.personnel.filter((p) => canPersonnelTravel(p)).length ===
                0 && (
                <option value="">
                  — No agents available for travel —
                </option>
              )}
              {runtime.personnel.map((person) => {
                const blockReason = getTravelBlockReason(person);
                const canTravel = blockReason === null;
                return (
                  <option
                    key={person.id}
                    value={person.id}
                    disabled={!canTravel}
                    style={getPersonnelOptionStyle(person)}
                  >
                    {person.name} · {formatRolesWithLevel(person)} ·{" "}
                    {getTraitsForPerson(person).join(", ") || "no traits"} ·{" "}
                    {canTravel
                      ? `${person.status} · ${getLocationLabel(person.locationId)}`
                      : `${person.status} (${blockReason}) — cannot travel`}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="field">
            Destination
            <select
              value={travelDestinationId}
              onChange={(event) => setTravelDestinationId(event.target.value)}
            >
              {enabledLocations.map((location) => (
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
            <button
              type="button"
              onClick={handleAssignTravel}
              disabled={
                !travelPersonnelId ||
                !travelDestinationId ||
                !canPersonnelTravel(
                  personnelById.get(travelPersonnelId) ?? ({} as Personnel),
                )
              }
            >
              Assign travel
            </button>
          </div>
          {travelPersonnelId &&
            personnelById.has(travelPersonnelId) &&
            !canPersonnelTravel(
              personnelById.get(travelPersonnelId) ?? ({} as Personnel),
            ) && (
              <p className="field-hint">
                This agent cannot travel while on a mission or resting.
              </p>
            )}
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
                  <button
                    type="button"
                    className="event-log-entry"
                    onClick={() => openEventDetail(event.id)}
                  >
                    {event.kind === "mission"
                      ? `${event.success ? "Successful" : "Failed"} ${planById.get(event.planId)?.name ?? event.planId} mission by ${
                          event.personnelIds
                            .map((id) => personnelById.get(id)?.name ?? id)
                            .join(", ")
                        } at ${getLocationLabel(event.locationId)}${
                          event.intelReport
                            ? ` — ${event.intelReport.summary}`
                            : ""
                        }${
                          event.roleGained?.length
                            ? ` — ${event.roleGained
                                .map(
                                  (g) =>
                                    `${personnelById.get(g.personnelId)?.name ?? g.personnelId} gained ${formatRoleLabel(g.roleId)}`,
                                )
                                .join("; ")}`
                            : ""
                        }`
                      : event.status === "started"
                        ? `${personnelById.get(event.personnelId)?.name ?? event.personnelId} departed ${
                            getLocationLabel(event.fromLocationId)
                          } for ${getLocationLabel(event.toLocationId)} (${event.travelHours ?? 0}h)`
                        : `${personnelById.get(event.personnelId)?.name ?? event.personnelId} arrived at ${
                            getLocationLabel(event.toLocationId)
                          } from ${getLocationLabel(event.fromLocationId)}`}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <footer className="app-footer">
        <button
          type="button"
          className="inline-link"
          onClick={() => (window.location.hash = "#/admin")}
        >
          Open Admin UI
        </button>
      </footer>
    </div>
  );
};
