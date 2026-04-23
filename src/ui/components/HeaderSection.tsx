import type { MissionOffer, MissionPlan, MissionInstance, Personnel, MaterialItem } from "../../models.js";

type HeaderSectionProps = {
  headerRef: React.RefObject<HTMLElement>;
  consolePanelRef: React.RefObject<HTMLDivElement>;
  completingSoonMissions: MissionInstance[];
  expiringSoonOffers: MissionOffer[];
  planById: Map<string, MissionPlan>;
  personnelById: Map<string, Personnel>;
  getLocationLabel: (locationId: string) => string;
  onLocationClick: (locationId: string) => void;
  onOfferClick: (offer: MissionOffer) => void;
  onPersonnelClick: (personnelId: string) => void;
  showConsoleMenu: boolean;
  onToggleConsoleMenu: () => void;
  onOpenSaveMenu: () => void;
  onOpenLoadMenu: () => void;
  onOpenAdmin: () => void;
  onRestart: () => void;
  speedLabel: string;
  onTogglePause: () => void;
  isPaused: boolean;
  pauseLocked?: boolean;
  hourFill: number;
  hourOfDay: number;
  year: number;
  month: number;
  day: number;
  yearFlashKey: number;
  monthFlashKey: number;
  dayFlashKey: number;
  dialFlashKey: number;
  onSlower: () => void;
  onFaster: () => void;
  resourcesText: string;
  materials: MaterialItem[];
  nowHours: number;
};

export const HeaderSection = ({
  headerRef,
  consolePanelRef,
  completingSoonMissions,
  expiringSoonOffers,
  planById,
  personnelById,
  getLocationLabel,
  onLocationClick,
  onOfferClick,
  onPersonnelClick,
  showConsoleMenu,
  onToggleConsoleMenu,
  onOpenSaveMenu,
  onOpenLoadMenu,
  onOpenAdmin,
  onRestart,
  speedLabel,
  onTogglePause,
  isPaused,
  pauseLocked,
  hourFill,
  hourOfDay,
  year,
  month,
  day,
  yearFlashKey,
  monthFlashKey,
  dayFlashKey,
  dialFlashKey,
  onSlower,
  onFaster,
  resourcesText,
  materials,
  nowHours,
}: HeaderSectionProps) => (
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
                onClick={() => onLocationClick(mission.locationId)}
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
                    onClick={() => onPersonnelClick(id)}
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
                onClick={() => onOfferClick(offer)}
              >
                {planById.get(offer.planId)?.name ?? offer.planId}
              </button>{" "}
              ·{" "}
              <button
                type="button"
                className="inline-link"
                onClick={() => onLocationClick(offer.locationId)}
              >
                {getLocationLabel(offer.locationId)}
              </button>{" "}
              · {Math.max(0, Math.ceil(offer.expiresAtHours - nowHours))}h left
            </li>
          ))}
        </ul>
      )}
    </div>
    <div className="card header-resources">
      <div className="header-resources-header">
        <h2 className="header-resources-title">Resources</h2>
        <div className="meta header-resources-meta">{resourcesText}</div>
      </div>
      <ul className="header-resources-list">
        {materials.map((item) => (
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
            onClick={onToggleConsoleMenu}
          >
            ⋮
          </button>
          {showConsoleMenu ? (
            <div className="console-menu-panel">
              <button type="button" onClick={onOpenSaveMenu}>
                Save
              </button>
              <button type="button" onClick={onOpenLoadMenu}>
                Load
              </button>
              <button type="button" onClick={onOpenAdmin}>
                Admin
              </button>
              <button type="button" onClick={onRestart}>
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
          <div className="speed-indicator meta">Speed: {speedLabel}</div>
          <div key={dialFlashKey} className="time-dial-wrap">
            <div
              className={`time-dial${isPaused ? " is-paused" : ""}${pauseLocked ? " is-locked" : ""}`}
              style={{ ["--dial-fill" as string]: `${hourFill}%` }}
              role="button"
              tabIndex={0}
              aria-label={pauseLocked ? "Paused — resolve event to continue" : isPaused ? "Resume time" : "Pause time"}
              onClick={onTogglePause}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onTogglePause();
                }
              }}
            >
              <div className="time-dial-center" />
              <div className="time-dial-label">{pauseLocked ? "🔒" : isPaused ? "⏸" : `${hourOfDay}h`}</div>
            </div>
            {pauseLocked && (
              <div className="pause-locked-hint meta">Resolve event to continue</div>
            )}
          </div>
        </div>
        <div className="actions">
          <button type="button" className="speed-button" onClick={onSlower}>
            Slower
          </button>
          <button type="button" className="speed-button" onClick={onFaster}>
            Faster
          </button>
        </div>
      </div>
    </div>
  </header>
);
