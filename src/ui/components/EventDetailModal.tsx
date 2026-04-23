import type {
  EnemyActionEvent,
  EventLogEntry,
  GameState,
  MissionEvent,
  NarrativeEventDef,
  NarrativeEventLog,
  NarrativeOutcome,
  TravelEvent,
} from "../../models.js";
import narrativeEventsData from "../../data/narrativeEvents.json";
import { getMissionPlan, getPersonnel } from "../../engine.js";
import { TraitBadge } from "./TraitBadge.js";

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

type EventDetailModalProps = {
  event: EventLogEntry | null;
  gameState: GameState;
  getLocationLabel: (locationId: string) => string;
  onClose: () => void;
  onLocationClick: (locationId: string) => void;
  onPersonnelClick: (personnelId: string) => void;
};

export const EventDetailModal = ({
  event,
  gameState,
  getLocationLabel,
  onClose,
  onLocationClick,
  onPersonnelClick,
}: EventDetailModalProps) => {
  if (!event) {
    return null;
  }

  if (event.kind === "enemy-action") {
    return (
      <EnemyActionModal
        event={event}
        gameState={gameState}
        getLocationLabel={getLocationLabel}
        onClose={onClose}
        onPersonnelClick={onPersonnelClick}
      />
    );
  }

  if (event.kind === "mission") {
    return (
      <MissionReportModal
        missionEvent={event}
        gameState={gameState}
        getLocationLabel={getLocationLabel}
        onClose={onClose}
        onLocationClick={onLocationClick}
        onPersonnelClick={onPersonnelClick}
      />
    );
  }

  if (event.kind === "narrative") {
    return (
      <NarrativeEventDetailModal
        event={event}
        getLocationLabel={getLocationLabel}
        onClose={onClose}
      />
    );
  }

  if (event.kind === "travel") {
    return (
      <TravelDetailModal
        travelEvent={event}
        gameState={gameState}
        getLocationLabel={getLocationLabel}
        onClose={onClose}
        onLocationClick={onLocationClick}
        onPersonnelClick={onPersonnelClick}
      />
    );
  }

  return null;
};

type MissionReportProps = {
  missionEvent: MissionEvent;
  gameState: GameState;
  getLocationLabel: (locationId: string) => string;
  onClose: () => void;
  onLocationClick: (locationId: string) => void;
  onPersonnelClick: (personnelId: string) => void;
};

const MissionReportModal = ({
  missionEvent,
  gameState,
  getLocationLabel,
  onClose,
  onLocationClick,
  onPersonnelClick,
}: MissionReportProps) => {
  const plan = getMissionPlan(gameState, missionEvent.planId);
  const { rewardsApplied } = missionEvent;
  const materialCatalog = gameState.data.materialCatalog;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Mission report"
    >
      <div className="modal-card event-detail-modal">
        <div className="modal-header">
          <h3>Mission Report</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="event-detail-section">
            <h4>Mission</h4>
            <p className="event-detail-mission-name">
              {plan?.name ?? missionEvent.planId}
            </p>
            {plan?.summary ? (
              <p className="meta">{plan.summary}</p>
            ) : null}
            <p className="meta">
              Type: {plan?.type ?? missionEvent.planId}
              {missionEvent.locationId && missionEvent.locationId !== "galaxy"
                ? ` · Location: `
                : null}
              {missionEvent.locationId && missionEvent.locationId !== "galaxy" ? (
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => onLocationClick(missionEvent.locationId)}
                >
                  {getLocationLabel(missionEvent.locationId)}
                </button>
              ) : null}
            </p>
          </section>

          <section className="event-detail-section">
            <h4>Agents</h4>
            <ul className="event-detail-list">
              {missionEvent.personnelIds.map((id) => {
                const person = getPersonnel(gameState, id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => onPersonnelClick(id)}
                    >
                      {person?.name ?? id}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="event-detail-section">
            <h4>Result</h4>
            <p className={missionEvent.success ? "event-detail-success" : "event-detail-failed"}>
              {missionEvent.success ? "Success" : "Failed"}
            </p>
            {missionEvent.intelReport ? (
              <p className="meta">
                <strong>What was learned:</strong> {missionEvent.intelReport.summary}
              </p>
            ) : null}
            {plan?.type === "training" ? (
              <div className="meta">
                <strong>Outcome:</strong>{" "}
                {(missionEvent.roleGained?.length ?? 0) > 0 ? (
                  <ul className="event-detail-sublist">
                    {missionEvent.roleGained!.map((g) => {
                      const person = getPersonnel(gameState, g.personnelId);
                      return (
                        <li key={`${g.personnelId}-${g.roleId}`}>
                          <button
                            type="button"
                            className="inline-link"
                            onClick={() => onPersonnelClick(g.personnelId)}
                          >
                            {person?.name ?? g.personnelId}
                          </button>
                          : {formatRoleLabel(g.roleId)}
                          {g.newLevel != null
                            ? ` +1 level (now level ${g.newLevel})`
                            : " gained (new)"}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <span className="meta">No role level increase this time.</span>
                )}
              </div>
            ) : (
              rewardsApplied &&
              (rewardsApplied.currency ||
                (rewardsApplied.items && rewardsApplied.items.length > 0) ||
                (rewardsApplied.effects && rewardsApplied.effects.length > 0) ||
                (rewardsApplied.locationAttributes &&
                  Object.keys(rewardsApplied.locationAttributes).length > 0)) ? (
                <div className="meta">
                  <strong>Outcome:</strong>
                  {rewardsApplied.currency &&
                  (rewardsApplied.currency.credits !== undefined ||
                    rewardsApplied.currency.intel !== undefined) ? (
                    <div className="event-detail-rewards">
                      {rewardsApplied.currency.credits !== undefined
                        ? ` Credits ${rewardsApplied.currency.credits >= 0 ? "+" : ""}${rewardsApplied.currency.credits}`
                        : ""}
                      {rewardsApplied.currency.intel !== undefined
                        ? ` Intel ${rewardsApplied.currency.intel >= 0 ? "+" : ""}${rewardsApplied.currency.intel}`
                        : ""}
                    </div>
                  ) : null}
                  {rewardsApplied.items && rewardsApplied.items.length > 0 ? (
                    <ul className="event-detail-sublist">
                      {rewardsApplied.items.map((item) => {
                        const name =
                          materialCatalog.find((c) => c.id === item.materialId)
                            ?.name ?? item.materialId;
                        return (
                          <li key={item.materialId}>
                            {item.quantity >= 0 ? "+" : ""}
                            {item.quantity} {name}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {rewardsApplied.effects && rewardsApplied.effects.length > 0 ? (
                    <ul className="event-detail-sublist">
                      {rewardsApplied.effects.map((effect, i) => (
                        <li key={`${effect.type}-${i}`}>{effect.type}</li>
                      ))}
                    </ul>
                  ) : null}
                  {rewardsApplied.locationAttributes &&
                  Object.keys(rewardsApplied.locationAttributes).length > 0 ? (
                    <div className="event-detail-rewards">
                      {rewardsApplied.locationAttributeChanges &&
                      Object.keys(rewardsApplied.locationAttributeChanges).length > 0 ? (
                        <>
                          <div className="meta">Location changes:</div>
                          {Object.entries(rewardsApplied.locationAttributeChanges).map(
                            ([key, change]) => {
                              const label = LOCATION_ATTR_LABELS[key] ?? key;
                              const delta = rewardsApplied.locationAttributes?.[key as keyof typeof rewardsApplied.locationAttributes];
                              return (
                                <div key={key} className="event-detail-location-attr">
                                  {label}: {change.before} → {change.after}
                                  {delta !== undefined ? ` (${delta >= 0 ? "+" : ""}${delta})` : ""}
                                </div>
                              );
                            },
                          )}
                        </>
                      ) : (
                        <span>
                          Location:{" "}
                          {Object.entries(rewardsApplied.locationAttributes)
                            .map(
                              ([key, delta]) =>
                                `${LOCATION_ATTR_LABELS[key] ?? key} ${delta >= 0 ? "+" : ""}${delta}`,
                            )
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null
            )}
          </section>

          {missionEvent.success &&
          missionEvent.recruitedPersonnelIds &&
          missionEvent.recruitedPersonnelIds.length > 0 ? (
            <section className="event-detail-section">
              <h4>New recruit{missionEvent.recruitedPersonnelIds.length !== 1 ? "s" : ""}</h4>
              <ul className="event-detail-list">
                {missionEvent.recruitedPersonnelIds.map((id) => {
                  const person = getPersonnel(gameState, id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => onPersonnelClick(id)}
                      >
                        {person?.name ?? id}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {(plan?.type === "rescue" || plan?.type === "search") &&
          missionEvent.rescuedPersonnelIds &&
          missionEvent.rescuedPersonnelIds.length > 0 ? (
            <section className="event-detail-section">
              <h4>{plan.type === "rescue" ? "Rescued" : "Found"}</h4>
              <ul className="event-detail-list">
                {missionEvent.rescuedPersonnelIds.map((id) => {
                  const person = getPersonnel(gameState, id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => onPersonnelClick(id)}
                      >
                        {person?.name ?? id}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {missionEvent.targetAdverseOutcomes &&
          missionEvent.targetAdverseOutcomes.length > 0 ? (
            <section className="event-detail-section">
              <h4>Target fate</h4>
              <ul className="event-detail-list">
                {missionEvent.targetAdverseOutcomes.map(({ personnelId, outcome, newLocationId }) => {
                  const person = getPersonnel(gameState, personnelId);
                  return (
                    <li key={personnelId}>
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => onPersonnelClick(personnelId)}
                      >
                        {person?.name ?? personnelId}
                      </button>{" "}
                      {outcome === "executed"
                        ? "was executed during the failed rescue attempt."
                        : newLocationId
                          ? `was moved to ${getLocationLabel(newLocationId)}.`
                          : "was moved to an unknown location."}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {((plan?.type !== "training" &&
            (missionEvent.roleGained?.length ?? 0) > 0) ||
            (missionEvent.traitGained?.length ?? 0) > 0) ? (
            <section className="event-detail-section">
              <h4>Agent development</h4>
              {missionEvent.roleGained &&
              missionEvent.roleGained.length > 0 &&
              plan?.type !== "training" ? (
                <ul className="event-detail-list">
                  {missionEvent.roleGained.map((g) => {
                    const person = getPersonnel(gameState, g.personnelId);
                    return (
                      <li key={`${g.personnelId}-${g.roleId}`}>
                        <button
                          type="button"
                          className="inline-link"
                          onClick={() => onPersonnelClick(g.personnelId)}
                        >
                          {person?.name ?? g.personnelId}
                        </button>{" "}
                        {g.newLevel != null
                          ? `${formatRoleLabel(g.roleId)} +1 level (now level ${g.newLevel})`
                          : `gained ${formatRoleLabel(g.roleId)}`}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {missionEvent.traitGained && missionEvent.traitGained.length > 0 ? (
                <ul className="event-detail-list">
                  {missionEvent.traitGained.map((g) => {
                    const person = getPersonnel(gameState, g.personnelId);
                    return (
                      <li key={`${g.personnelId}-${g.traitId}`}>
                        <button
                          type="button"
                          className="inline-link"
                          onClick={() => onPersonnelClick(g.personnelId)}
                        >
                          {person?.name ?? g.personnelId}
                        </button>{" "}
                        gained <TraitBadge id={g.traitId} />
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};

type TravelDetailProps = {
  travelEvent: TravelEvent;
  gameState: GameState;
  getLocationLabel: (locationId: string) => string;
  onClose: () => void;
  onLocationClick: (locationId: string) => void;
  onPersonnelClick: (personnelId: string) => void;
};

const TravelDetailModal = ({
  travelEvent,
  gameState,
  getLocationLabel,
  onClose,
  onLocationClick,
  onPersonnelClick,
}: TravelDetailProps) => {
  const person = getPersonnel(gameState, travelEvent.personnelId);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Travel event detail"
    >
      <div className="modal-card event-detail-modal">
        <div className="modal-header">
          <h3>Travel Report</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="event-detail-section">
            <h4>From</h4>
            <p>
              <button
                type="button"
                className="inline-link"
                onClick={() => onLocationClick(travelEvent.fromLocationId)}
              >
                {getLocationLabel(travelEvent.fromLocationId)}
              </button>
            </p>
          </section>

          <section className="event-detail-section">
            <h4>To</h4>
            <p>
              <button
                type="button"
                className="inline-link"
                onClick={() => onLocationClick(travelEvent.toLocationId)}
              >
                {getLocationLabel(travelEvent.toLocationId)}
              </button>
            </p>
          </section>

          <section className="event-detail-section">
            <h4>Who</h4>
            <p>
              <button
                type="button"
                className="inline-link"
                onClick={() => onPersonnelClick(travelEvent.personnelId)}
              >
                {person?.name ?? travelEvent.personnelId}
              </button>
            </p>
          </section>

          <section className="event-detail-section">
            <h4>Travel time</h4>
            <p className="meta">
              {travelEvent.travelHours ?? 0} hour
              {(travelEvent.travelHours ?? 0) !== 1 ? "s" : ""}
            </p>
          </section>

          <section className="event-detail-section">
            <h4>On the way</h4>
            <p className="meta">No incidents reported.</p>
          </section>
        </div>
      </div>
    </div>
  );
};

const ACTION_LABELS: Record<string, string> = {
  "patrol-increase": "Patrols Tightened",
  propaganda: "Imperial Propaganda",
  arrest: "Agent Arrested",
  "counter-op": "Counter-Operation",
};

const ACTION_DESCRIPTIONS: Record<string, string> = {
  "patrol-increase":
    "Imperial forces increased garrison strength and patrol frequency at this location.",
  propaganda:
    "Imperial propaganda reduced popular support at this location.",
  arrest:
    "Imperial agents arrested a rebel operative at this location.",
  "counter-op":
    "Imperial counter-intelligence detected a rebel mission and moved to compromise it.",
};

const EnemyActionModal = ({
  event,
  gameState,
  getLocationLabel,
  onClose,
  onPersonnelClick,
}: {
  event: EnemyActionEvent;
  gameState: GameState;
  getLocationLabel: (id: string) => string;
  onClose: () => void;
  onPersonnelClick: (id: string) => void;
}) => {
  const person = event.personnelId
    ? gameState.runtime.personnel.find((p) => p.id === event.personnelId)
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card event-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-detail-header">
          <div className="event-detail-title">
            <span className="event-detail-result is-negative">
              {ACTION_LABELS[event.action] ?? "Enemy Activity"}
            </span>
            <h2>{getLocationLabel(event.locationId)}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="event-detail-body">
          <section className="event-detail-section">
            <p className="meta">{ACTION_DESCRIPTIONS[event.action] ?? "Imperial activity detected."}</p>
          </section>
          {person && (
            <section className="event-detail-section">
              <h4>Arrested</h4>
              <ul className="event-detail-list">
                <li>
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => onPersonnelClick(person.id)}
                  >
                    {person.name}
                  </button>
                </li>
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

const NARRATIVE_CATEGORY_LABELS: Record<NarrativeEventDef["category"], string> = {
  windfall: "Windfall",
  threat: "Threat",
  opportunity: "Opportunity",
  complication: "Complication",
};

const NARRATIVE_CATEGORY_COLORS: Record<NarrativeEventDef["category"], string> = {
  windfall: "#3fb950",
  threat: "#f85149",
  opportunity: "#58a6ff",
  complication: "#d29922",
};

const formatOutcome = (o: NarrativeOutcome): string => {
  if (o.type === "resources") {
    const parts: string[] = [];
    if (o.credits) parts.push(`${o.credits > 0 ? "+" : ""}${o.credits} credits`);
    if (o.intel) parts.push(`${o.intel > 0 ? "+" : ""}${o.intel} intel`);
    return parts.join(", ") || "No effect";
  }
  if (o.type === "material") {
    return `${o.quantity > 0 ? "+" : ""}${o.quantity} ${o.materialId}`;
  }
  if (o.type === "location-attribute") {
    return `${o.delta > 0 ? "+" : ""}${o.delta} ${o.key}`;
  }
  return "No effect";
};

const NarrativeEventDetailModal = ({
  event,
  getLocationLabel,
  onClose,
}: {
  event: NarrativeEventLog;
  getLocationLabel: (id: string) => string;
  onClose: () => void;
}) => {
  const defs = (narrativeEventsData as { events: NarrativeEventDef[] }).events;
  const def = defs.find((d) => d.id === event.eventId);
  const choice = def?.choices.find((c) => c.id === event.choiceId);
  const nonNullOutcomes = (event.outcomes as NarrativeOutcome[]).filter((o) => o.type !== "nothing");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Event record">
      <div className="modal-card event-detail-modal">
        <div className="modal-header">
          <h3>Event Record</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          {def && (
            <section className="event-detail-section">
              <span
                className="narrative-category-badge"
                style={{ color: NARRATIVE_CATEGORY_COLORS[def.category] }}
              >
                {NARRATIVE_CATEGORY_LABELS[def.category]}
              </span>
              <p className="event-detail-mission-name">{def.title}</p>
              <p className="meta">{def.body}</p>
              <p className="meta">Location: {getLocationLabel(event.locationId)}</p>
            </section>
          )}
          {choice && (
            <section className="event-detail-section">
              <h4>Decision</h4>
              <p>
                {choice.label}
                {event.choiceSuccess != null && (
                  <span className={`narrative-roll-result ${event.choiceSuccess ? "roll-success" : "roll-failure"}`}>
                    {event.choiceSuccess ? " ✓ Success" : " ✗ Failed"}
                  </span>
                )}
              </p>
              {choice.flavor && <p className="meta">{choice.flavor}</p>}
            </section>
          )}
          <section className="event-detail-section">
            <h4>Effects</h4>
            {nonNullOutcomes.length === 0 ? (
              <p className="meta">No effect.</p>
            ) : (
              <ul className="event-detail-list">
                {nonNullOutcomes.map((o, i) => (
                  <li key={i}>{formatOutcome(o)}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
