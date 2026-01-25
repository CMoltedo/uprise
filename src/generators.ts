import type { GameState, Personnel, PersonnelSkill } from "./models.js";

const FIRST_NAMES = [
  "Avery",
  "Cass",
  "Dax",
  "Eris",
  "Finn",
  "Juno",
  "Kara",
  "Lenn",
  "Mira",
  "Orin",
  "Rhea",
  "Soren",
  "Tali",
  "Vex",
  "Zane",
];

const LAST_NAMES = [
  "Arden",
  "Bexley",
  "Corin",
  "Dray",
  "Eldar",
  "Hale",
  "Kestrel",
  "Marin",
  "Rook",
  "Vale",
  "Voss",
  "Wren",
];

const TRAITS = [
  "cautious",
  "quick-learner",
  "charismatic",
  "schemer",
  "reckless",
  "loyal",
  "stoic",
  "hotheaded",
  "empathetic",
  "proud",
  "observant",
  "resourceful",
];

const SKILLS: PersonnelSkill[] = ["agent", "diplomat", "pilot", "operative"];

const pickOne = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const pickMany = <T,>(items: T[], count: number) => {
  const pool = [...items];
  const picked: T[] = [];
  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
};

const buildUniqueId = (prefix: string, existing: Set<string>) => {
  let id = "";
  do {
    id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  } while (existing.has(id));
  return id;
};

const buildUniqueName = (existing: Set<string>) => {
  const first = pickOne(FIRST_NAMES);
  const last = pickOne(LAST_NAMES);
  let name = `${first} ${last}`;
  let suffix = 2;
  while (existing.has(name)) {
    name = `${first} ${last} ${suffix}`;
    suffix += 1;
  }
  return name;
};

export const generatePersonnel = (
  state: GameState,
  options?: { locationId?: string },
): Personnel => {
  const existingIds = new Set(
    state.runtime.personnel.map((person) => person.id),
  );
  const existingNames = new Set(
    state.runtime.personnel.map((person) => person.name),
  );
  const skillCount = Math.random() < 0.6 ? 1 : 2;
  const traitCount = Math.random() < 0.5 ? 1 : 2;
  const locationId =
    options?.locationId ??
    state.runtime.headquartersId ??
    state.data.locations[0]?.id ??
    "";

  return {
    id: buildUniqueId("personnel", existingIds),
    name: buildUniqueName(existingNames),
    skills: pickMany(SKILLS, skillCount),
    traits: pickMany(TRAITS, traitCount),
    status: "idle",
    locationId,
  };
};
