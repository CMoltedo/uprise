const UNIVERSE_START_UTC = Date.UTC(3635, 0, 1, 0, 0, 0, 0);

export const SPEEDS = [
  { label: "Very slow (1h / 30s)", hoursPerSecond: 1 / 30 },
  { label: "Slow (1h / 10s)", hoursPerSecond: 1 / 10 },
  { label: "Normal (1h / 1s)", hoursPerSecond: 1 },
  { label: "Fast (6h / 1s)", hoursPerSecond: 6 },
  { label: "Very fast (12h / 1s)", hoursPerSecond: 12 },
] as const;

export type Speed = (typeof SPEEDS)[number];

export const getUniverseDate = (hours: number) =>
  new Date(UNIVERSE_START_UTC + hours * 60 * 60 * 1000);

export const getHourOfDay = (hours: number) => ((hours % 24) + 24) % 24;

export const formatInUniverseTime = (hours: number) => {
  const date = getUniverseDate(hours);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:00 (BBY 18)`;
};

export const createHourAccumulator = (initialSpeed: Speed, nowHours = 0) => {
  let speed = initialSpeed;
  let buffer = 0;
  let alignPending =
    speed.hoursPerSecond > 1 &&
    getHourOfDay(nowHours) % Math.floor(speed.hoursPerSecond) !== 0;

  const setSpeed = (nextSpeed: Speed, currentHours: number) => {
    speed = nextSpeed;
    buffer = 0;
    if (speed.hoursPerSecond > 1) {
      const block = Math.floor(speed.hoursPerSecond);
      const hourOfDay = getHourOfDay(currentHours);
      alignPending = hourOfDay % block !== 0;
    } else {
      alignPending = false;
    }
  };

  const getAlignedFastAdvance = (nowHours: number, block: number) => {
    const hourOfDay = getHourOfDay(nowHours);
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

  const alignNow = (nowHours: number) => {
    if (speed.hoursPerSecond <= 1) {
      return 0;
    }
    if (!alignPending) {
      return 0;
    }
    const block = Math.floor(speed.hoursPerSecond);
    alignPending = false;
    return getAlignedFastAdvance(nowHours, block);
  };

  const tick = (nowHours: number) => {
    if (speed.hoursPerSecond > 1) {
      return getFastAdvance(nowHours);
    }
    return getSlowAdvance();
  };

  return { setSpeed, alignNow, tick };
};
