import type { GameRuntime, MissionPlan, Personnel, Planet, Sector, Location } from "../models.js";

export const formatResources = (runtime: GameRuntime) =>
  `Cr ${runtime.resources.credits} · Intel ${runtime.resources.intel}`;

export const buildIdMap = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, item]));

export const getLocationLabel = (
  locationId: string,
  locationById: Map<string, Location>,
  planetById: Map<string, Planet>,
  sectorById: Map<string, Sector>,
) => {
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

export const getPlanHoursLeftLabel = (
  plan: MissionPlan,
  offerHoursByPlanId: Map<string, number>,
  nowHours: number,
) => {
  const offerHours = offerHoursByPlanId.get(plan.id);
  if (offerHours !== undefined) {
    return `(${Math.ceil(offerHours)}h)`;
  }
  if (plan.availability?.type === "time") {
    const hoursLeft = Math.max(0, plan.availability.endHours - nowHours);
    return `(${Math.ceil(hoursLeft)}h)`;
  }
  if (plan.availability?.type === "global") {
    return "(∞h)";
  }
  return "(?h)";
};

export const getPersonnelStatusMeta = (person: Personnel) => {
  if (person.status === "wounded") {
    return { label: "injured", className: "is-injured" };
  }
  if (person.status === "assigned" || person.status === "traveling") {
    return { label: "on mission", className: "is-mission" };
  }
  if (person.status === "resting") {
    return { label: "resting", className: "is-resting" };
  }
  return { label: "idle", className: "is-idle" };
};

export const getPersonnelOptionStyle = (person: Personnel) => {
  const isUnavailable =
    person.status === "wounded" ||
    person.status === "assigned" ||
    person.status === "traveling" ||
    person.status === "resting";
  return isUnavailable ? { color: "#6b7280" } : undefined;
};
