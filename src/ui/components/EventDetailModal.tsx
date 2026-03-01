import type {
  EventLogEntry,
  GameState,
  MissionEvent,
  TravelEvent,
} from "../../models.js";
import { getMissionPlan, getPersonnel } from "../../engine.js";

const formatRoleLabel = (roleId: string) =>
  roleId.charAt(0).toUpperCase() + roleId.slice(1);

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
                      const level = person?.roleLevels?.[g.roleId] ?? 1;
                      return (
                        <li key={`${g.personnelId}-${g.roleId}`}>
                          <button
                            type="button"
                            className="inline-link"
                            onClick={() => onPersonnelClick(g.personnelId)}
                          >
                            {person?.name ?? g.personnelId}
                          </button>
                          : {formatRoleLabel(g.roleId)} +1 level (now level {level})
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
                (rewardsApplied.effects && rewardsApplied.effects.length > 0)) ? (
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
                        gained {formatRoleLabel(g.roleId)}
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
                        gained {g.traitId}
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
