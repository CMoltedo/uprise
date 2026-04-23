import React from "react";

interface TraitInfo {
  label: string;
  tooltip: string;
}

const TRAIT_INFO: Record<string, TraitInfo> = {
  // Immutable personality traits
  cautious: {
    label: "Cautious",
    tooltip: "Lowers operational risk on all missions.",
  },
  reckless: {
    label: "Reckless",
    tooltip: "Boosts success chance but raises personal risk.",
  },
  "quick-learner": {
    label: "Quick Learner",
    tooltip: "Gains role XP faster from missions.",
  },
  loyal: {
    label: "Loyal",
    tooltip: "Resists capture-induced defection; morale anchor.",
  },
  charismatic: {
    label: "Charismatic",
    tooltip: "Bonus to diplomacy and recruit missions.",
  },
  schemer: {
    label: "Schemer",
    tooltip: "Bonus to espionage and deception missions.",
  },
  stoic: {
    label: "Stoic",
    tooltip: "Unaffected by adverse morale events.",
  },
  hotheaded: {
    label: "Hotheaded",
    tooltip: "Raises success chance but also raises personal risk.",
  },
  empathetic: {
    label: "Empathetic",
    tooltip: "Bonus to diplomacy; speeds ally recovery.",
  },
  proud: {
    label: "Proud",
    tooltip: "Penalty when assigned below their usual role level.",
  },
  steady: {
    label: "Steady",
    tooltip: "Consistent performance; low variance outcomes.",
  },
  calculating: {
    label: "Calculating",
    tooltip: "Bonus on intel and planning missions.",
  },
  meticulous: {
    label: "Meticulous",
    tooltip: "Reduces material consumption on missions.",
  },
  // Mutable traits gained during play
  "battle-hardened": {
    label: "Battle-Hardened",
    tooltip: "Reduces personal risk on combat missions.",
  },
  "field-medic": {
    label: "Field Medic",
    tooltip: "Speeds recovery of wounded allies at same location.",
  },
  ghost: {
    label: "Ghost",
    tooltip: "Drastically lowers detection risk on espionage missions.",
  },
  connections: {
    label: "Connections",
    tooltip: "Unlocks additional recruit-allies opportunities.",
  },
  scarred: {
    label: "Scarred",
    tooltip: "Slight penalty to diplomacy; gained after severe injury.",
  },
  trauma: {
    label: "Trauma",
    tooltip: "Penalty to all success rolls; gained after capture.",
  },
  "double-agent": {
    label: "Double Agent",
    tooltip: "Rare; can feed false intel to the enemy.",
  },
  decorated: {
    label: "Decorated",
    tooltip: "Morale bonus to all personnel at same location.",
  },
  burned: {
    label: "Burned",
    tooltip: "Known to enemy; raises risk on all missions at hostile locations.",
  },
  resilient: {
    label: "Resilient",
    tooltip: "Faster recovery from wounds; gained after surviving capture.",
  },
  veteran: {
    label: "Veteran",
    tooltip: "Broad bonus to success and risk reduction on all mission types.",
  },
  shaken: {
    label: "Shaken",
    tooltip: "Penalty to success rolls; gained after a traumatic mission failure. Fades with time.",
  },
};

export function formatTraitLabel(id: string): string {
  return TRAIT_INFO[id]?.label ?? id;
}

interface Props {
  id: string;
}

export function TraitBadge({ id }: Props) {
  const info = TRAIT_INFO[id];
  const label = info?.label ?? id;
  const tip = info ? `${info.label}: ${info.tooltip}` : id;
  return (
    <span className="trait-badge" data-tooltip={tip}>
      {label}
    </span>
  );
}
