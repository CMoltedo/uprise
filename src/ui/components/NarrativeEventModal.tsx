import React from "react";
import type { NarrativeEventDef, NarrativePending } from "../../models.js";

interface Props {
  pending: NarrativePending;
  def: NarrativeEventDef;
  onChoose: (pendingId: string, choiceId: string) => void;
  onDismiss: (pendingId: string) => void;
  getLocationLabel: (id: string) => string;
}

const CATEGORY_LABELS: Record<NarrativeEventDef["category"], string> = {
  windfall: "Windfall",
  threat: "Threat",
  opportunity: "Opportunity",
  complication: "Complication",
};

const CATEGORY_COLORS: Record<NarrativeEventDef["category"], string> = {
  windfall: "#3fb950",
  threat: "#f85149",
  opportunity: "#58a6ff",
  complication: "#d29922",
};

export function NarrativeEventModal({ pending, def, onChoose, onDismiss, getLocationLabel }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card narrative-event-modal">
        <div className="modal-header">
          <div>
            <span
              className="narrative-category-badge"
              style={{ color: CATEGORY_COLORS[def.category] }}
            >
              {CATEGORY_LABELS[def.category]}
            </span>
            <h3>{def.title}</h3>
          </div>
        </div>
        <div className="modal-body">
          <section className="event-detail-section">
            <p>{def.body}</p>
            <p className="meta">At {getLocationLabel(pending.locationId)}</p>
          </section>
          <section className="event-detail-section">
            <div className="narrative-choices">
              {def.choices.map((choice) => {
                const sc = (choice as { successChance?: number }).successChance;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className="narrative-choice-btn"
                    onClick={() => onChoose(pending.id, choice.id)}
                  >
                    <span className="narrative-choice-label">
                      {choice.label}
                      {sc != null && (
                        <span className="narrative-risk-badge">⚡ {Math.round(sc * 100)}%</span>
                      )}
                    </span>
                    {choice.flavor && (
                      <span className="narrative-choice-flavor">{choice.flavor}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="button-secondary" onClick={() => onDismiss(pending.id)}>
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}
