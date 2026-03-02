import type { GameState, Personnel, PersonnelRole } from "./models.js";
import balance from "./data/balance.json";

const FIRST_NAMES = [
  "Avery",
  "Bailey",
  "Cass",
  "Dax",
  "Eris",
  "Finn",
  "Georgie",
  "Harold",
  "Issac",
  "Juno",
  "Kara",
  "Lenn",
  "Mira",
  "Nick",
  "Orin",
  "Phoenix",
  "Quinn",
  "Rhea",
  "Soren",
  "Tali",
  "Ulric",
  "Vex",
  "Willow",
  "Xavier",
  "Yvaine",
  "Zane",
];

const LAST_NAMES = [
  "Arden",
  "Bexley",
  "Corin",
  "Dray",
  "Eldar",
  "Flynn",
  "Grimm",
  "Hale",
  "Indigo",
  "Jade",
  "Kestrel",
  "Lyra",
  "Marin",
  "Nexis",
  "Orion",
  "Pyre",
  "Quill",
  "Rook",
  "Stryker",
  "Thayne",
  "Vale",
  "Voss",
  "Wren",
  "Xi",
  "Yul",
  "Zen"
];

const ROLES: PersonnelRole[] = (balance.personnelRoles ??
  []) as PersonnelRole[];

const IMMUTABLE_POOL: string[] = balance.immutableTraits ?? [];
const CLASS_POOL: string[] = balance.traitClass ?? [];
const immutableChance = (balance as { immutableTraitChance?: number }).immutableTraitChance ?? 0.2;
const immutableMin = (balance as { immutableTraitMinCount?: number }).immutableTraitMinCount ?? 1;
const immutableMax = (balance as { immutableTraitMaxCount?: number }).immutableTraitMaxCount ?? 3;

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

/** Pick immutable traits: 1-3 total, at most one from class pool. */
function pickImmutableTraits(): string[] {
  if (IMMUTABLE_POOL.length === 0) {
    return [];
  }
  if (Math.random() >= immutableChance) {
    return [];
  }
  const count =
    immutableMin +
    Math.floor(Math.random() * (immutableMax - immutableMin + 1));
  const personalityOnly = IMMUTABLE_POOL.filter((t) => !CLASS_POOL.includes(t));
  const result: string[] = [];
  const used = new Set<string>();

  if (CLASS_POOL.length > 0 && count > 0 && Math.random() < 0.5) {
    const cls = pickOne(CLASS_POOL);
    result.push(cls);
    used.add(cls);
  }

  const remaining = personalityOnly.filter((t) => !used.has(t));
  const need = count - result.length;
  if (need > 0 && remaining.length > 0) {
    const picked = pickMany(remaining, Math.min(need, remaining.length));
    result.push(...picked);
  }

  return result;
}

const buildUniqueId = (prefix: string, existing: Set<string>) => {
  let id = "";
  do {
    id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  } while (existing.has(id));
  return id;
};

const MAX_NAME_RETRIES = 15;

const buildUniqueName = (existing: Set<string>) => {
  for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt++) {
    const first = pickOne(FIRST_NAMES);
    const last = pickOne(LAST_NAMES);
    const name = `${first} ${last}`;
    if (!existing.has(name)) {
      return name;
    }
  }
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
  const locationId =
    options?.locationId ??
    state.runtime.headquartersId ??
    state.data.locations[0]?.id ??
    "";

  const roles = pickMany(ROLES, roleCount);
  const roleLevels = Object.fromEntries(roles.map((r) => [r, 1])) as Partial<
    Record<PersonnelRole, number>
  >;
  const immutableTraits = pickImmutableTraits();

  return {
    id: buildUniqueId("personnel", existingIds),
    name: buildUniqueName(existingNames),
    roles,
    roleLevels,
    immutableTraits,
    mutableTraits: [],
    status: "idle",
    locationId,
  };
};
