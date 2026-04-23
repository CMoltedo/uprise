import React from "react";
import type { GameState } from "../../models.js";

const MESSAGES: Record<string, { heading: string; body: string }> = {
  "popular-support": {
    heading: "The Rebellion Prevails",
    body: "The people have rallied to your cause. Imperial control across the galaxy has been broken.",
  },
  "all-agents-gone": {
    heading: "The Cell Is Wiped Out",
    body: "Every agent has been killed, captured, or gone missing. The rebellion ends here.",
  },
  "hq-lost": {
    heading: "Headquarters Lost",
    body: "Imperial crackdowns have crushed support at your base of operations. The rebellion collapses.",
  },
};

interface Props {
  state: GameState;
  onRestart: () => void;
  onDismiss: () => void;
}

export function GameEndOverlay({ state, onRestart, onDismiss }: Props) {
  const { phase, phaseReason } = state.runtime;
  if (!phase || phase === "active") return null;

  const msg = MESSAGES[phaseReason ?? ""] ?? {
    heading: phase === "victory" ? "Victory" : "Defeat",
    body: "",
  };

  return (
    <div className="game-end-overlay">
      <div className="game-end-card">
        <div className={`game-end-result ${phase}`}>
          {phase === "victory" ? "Victory" : "Defeat"}
        </div>
        <h2>{msg.heading}</h2>
        <p>{msg.body}</p>
        <div className="game-end-actions">
          <button type="button" className="button-primary" onClick={onRestart}>
            Start New Game
          </button>
          <button type="button" className="button-secondary" onClick={onDismiss}>
            Keep Playing
          </button>
        </div>
      </div>
    </div>
  );
}
