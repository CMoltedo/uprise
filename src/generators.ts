import type { GameState, Personnel, PersonnelRole } from "./models.js";
import balance from "./data/balance.json";

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

const TRAITS = balance.personnelTraits ?? [];

const ROLES: PersonnelRole[] = (balance.personnelRoles ??
  []) as PersonnelRole[];

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
  const roleCount = Math.random() < 0.6 ? 1 : 2;
  const traitCount = Math.random() < 0.5 ? 1 : 2;
  const locationId =
    options?.locationId ??
    state.runtime.headquartersId ??
    state.data.locations[0]?.id ??
    "";

  const roles = pickMany(ROLES, roleCount);
  const roleLevels = Object.fromEntries(roles.map((r) => [r, 1])) as Partial<
    Record<PersonnelRole, number>
  >;
  return {
    id: buildUniqueId("personnel", existingIds),
    name: buildUniqueName(existingNames),
    roles,
    roleLevels,
    traits: pickMany(TRAITS, traitCount),
    status: "idle",
    locationId,
  };
};
