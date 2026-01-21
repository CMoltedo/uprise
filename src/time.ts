const UNIVERSE_START_UTC = Date.UTC(3635, 0, 1, 0, 0, 0, 0);

export const SPEEDS = [
  { label: "Very slow (1h / 30s)", hoursPerSecond: 1 / 30 },
  { label: "Slow (1h / 10s)", hoursPerSecond: 1 / 10 },
  { label: "Normal (1h / 1s)", hoursPerSecond: 1 },
  { label: "Fast (6h / 1s)", hoursPerSecond: 6 },
  { label: "Very fast (12h / 1s)", hoursPerSecond: 12 },
] as const;

export type Speed = (typeof SPEEDS)[number];

export const formatInUniverseTime = (hours: number) => {
  const date = new Date(UNIVERSE_START_UTC + hours * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:00 (BBY 18)`;
};

export const createHourAccumulator = (initialSpeed: Speed) => {
  let speed = initialSpeed;
  let buffer = 0;
  let alignPending = speed.hoursPerSecond > 1;

  const setSpeed = (nextSpeed: Speed) => {
    speed = nextSpeed;
    buffer = 0;
    alignPending = speed.hoursPerSecond > 1;
  };

  const getAlignedFastAdvance = (nowHours: number, block: number) => {
    const hourOfDay = ((nowHours % 24) + 24) % 24;
    const remainder = hourOfDay % block;
    return remainder === 0 ? block : block - remainder;
  };

  const getFastAdvance = (nowHours: number) => {
    const block = Math.floor(speed.hoursPerSecond);
    if (alignPending) {
      alignPending = false;
      return getAlignedFastAdvance(nowHours, block);
    }
    return block;
  };

  const getSlowAdvance = () => {
    buffer += speed.hoursPerSecond;
    const hoursToAdvance = Math.floor(buffer);
    if (hoursToAdvance >= 1) {
      buffer -= hoursToAdvance;
      return hoursToAdvance;
    }
    return 0;
  };

  const tick = (nowHours: number) => {
    if (speed.hoursPerSecond > 1) {
      return getFastAdvance(nowHours);
    }
    return getSlowAdvance();
  };

  return { setSpeed, tick };
};
