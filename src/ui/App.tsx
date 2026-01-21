import { useEffect, useMemo, useRef, useState } from "react";
import { advanceTime, assignPersonnelToMission, assignTravel } from "../engine.js";
import type { GameState } from "../models.js";
import baselineState from "../data/baselineState.json";
import scenarioOverrides from "../data/scenarioOverrides.json";
import { SPEEDS, createHourAccumulator, formatInUniverseTime } from "../time.js";
import { buildScenario } from "../scenarios.js";
import type { ScenarioOverrides } from "../scenarios.js";

const formatResources = (state: GameState) =>
  `Cr ${state.resources.credits} · Intel ${state.resources.intel}`;

export const App = () => {
  const initialScenario = (() => {
    const baseline = JSON.parse(JSON.stringify(baselineState)) as GameState;
    return buildScenario(baseline, scenarioOverrides as ScenarioOverrides);
  })();

  const [state, setState] = useState<GameState>(() => initialScenario);
  const [speedIndex, setSpeedIndex] = useState<number>(2);
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    initialScenario.missionPlans[0]?.id ?? "",
  );
  const [selectedPersonnelIds, setSelectedPersonnelIds] = useState<string[]>(
    [],
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
  const selectedPersonnel = useMemo(
    () =>
      selectedPersonnelIds
        .map((id) => state.personnel.find((person) => person.id === id))
        .filter((person): person is NonNullable<typeof person> => Boolean(person)),
    [selectedPersonnelIds, state.personnel],
  );
  const selectedPersonnelLocationId = useMemo(() => {
    if (selectedPersonnel.length === 0) {
      return null;
    }
    const unique = new Set(selectedPersonnel.map((person) => person.locationId));
    if (unique.size !== 1) {
      return "mixed";
    }
    return selectedPersonnel[0]?.locationId ?? null;
  }, [selectedPersonnel]);
  const availablePlans = useMemo(() => {
    if (!selectedPersonnelLocationId || selectedPersonnelLocationId === "mixed") {
      return [];
    }
    const selectedLocation = state.locations.find(
      (location) => location.id === selectedPersonnelLocationId,
    );
    if (!selectedLocation) {
      return [];
    }
    const locationPlans = selectedLocation.missionPlanIds?.length
      ? state.missionPlans.filter((plan) =>
          selectedLocation.missionPlanIds?.includes(plan.id),
        )
      : state.missionPlans.filter((plan) => {
          if (plan.availability.type === "location") {
            return plan.availability.locationId === selectedLocation.id;
          }
          return false;
        });
    const globalPlans = state.missionPlans.filter(
      (plan) => plan.availability.type === "global",
    );
    return [...locationPlans, ...globalPlans];
  }, [state.missionPlans, selectedPersonnelLocationId, state.locations]);
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
  const timeAccumulatorRef = useRef(
    createHourAccumulator(SPEEDS[2], initialScenario.nowHours),
  );

  const handleAssignSample = () => {
    try {
      if (!selectedPlanId) {
        alert("Select a mission first.");
        return;
      }
      if (selectedPersonnelIds.length === 0) {
        alert("Select at least one personnel.");
        return;
      }
      const next = assignPersonnelToMission(
        state,
        selectedPlanId,
        selectedPersonnelIds,
      );
      setState(next);
      setSelectedPersonnelIds([]);
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
    if (!availablePlans.find((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(availablePlans[0]?.id ?? "");
    }
  }, [availablePlans, selectedPlanId]);

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

  return (
    <div className="page">
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
                <strong>{person.name}</strong> · {person.role} · {person.status}{" "}
                · {person.locationId}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                setSelectedPersonnelIds(
                  state.personnel
                    .filter((person) => person.status === "idle")
                    .map((person) => person.id),
                )
              }
            >
              Select all idle
            </button>
          </div>
          <h3>Travel Orders</h3>
          <label className="field">
            Personnel
            <select
              value={travelPersonnelId}
              onChange={(event) => setTravelPersonnelId(event.target.value)}
            >
              {state.personnel.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.status} · {person.locationId}
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
                  {location.name} · sector {location.sector.x},{location.sector.y}
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
          <label className="field">
            Personnel (multi-select)
            <select
              multiple
              value={selectedPersonnelIds}
              onChange={(event) => {
                const options = Array.from(event.target.selectedOptions);
                setSelectedPersonnelIds(options.map((option) => option.value));
              }}
              size={Math.min(6, state.personnel.length)}
            >
              {state.personnel.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.role} · {person.status} ·{" "}
                  {person.locationId}
                </option>
              ))}
            </select>
          </label>
          {selectedPersonnelIds.length === 0 ? (
            <div className="meta">Select personnel to see assignments.</div>
          ) : selectedPersonnelLocationId === "mixed" ? (
            <div className="meta">Selected personnel are in different locations.</div>
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
                  {plan.name} — {plan.summary}
                </option>
              ))}
            </select>
          </label>
          {selectedPlan ? (
            <div className="meta">
              {selectedPlan.name} · {selectedPlan.type} ·{" "}
              {selectedPlan.availability.type === "location"
                ? selectedPlan.availability.locationId
                : selectedPlan.availability.type}
              <div className="meta">
                Duration {selectedPlan.durationHours}h · Success{" "}
                {Math.round(selectedPlan.baseSuccessChance * 100)}%
              </div>
              <div className="meta">
                Roles: {selectedPlan.requiredRoles.join(", ")}
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
                  selectedPlan.rewards.materials
                    ? `${selectedPlan.rewards.materials} materials`
                    : null,
                  selectedPlan.rewards.intel
                    ? `${selectedPlan.rewards.intel} intel`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "none"}
              </div>
            </div>
          ) : (
            <div className="meta">Select an assignment to see details.</div>
          )}
          <div className="actions">
            <button type="button" onClick={handleAssignSample}>
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
                {mission.planId} · {mission.remainingHours}h remaining · pers{" "}
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

      <section className="card">
        <h2>Map Nodes</h2>
        <ul>
          {state.locations.map((location) => (
            <li key={location.id}>
              <strong>{location.name}</strong> · {location.tags.join(", ")}
              <div className="meta">
                Sector ({location.sector.x},{location.sector.y}) · Local (
                {location.position.x},{location.position.y})
              </div>
              <div className="meta">
                Secrecy {location.immutable.secrecy} · Resources{" "}
                {location.immutable.resources} · Willingness{" "}
                {location.immutable.willingness}
              </div>
              <div className="meta">
                Support {location.mutable.support} · Suspicion{" "}
                {location.mutable.suspicion} · Production{" "}
                {location.mutable.productionCapacity}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
