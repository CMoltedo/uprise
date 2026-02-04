import { useEffect, useRef } from "react";
import { advanceTime } from "../engine.js";
import type { GameState } from "../models.js";
import { SPEEDS, createHourAccumulator } from "../time.js";

type GameClockOptions = {
  initialHours: number;
  speedIndex: number;
  isPaused: boolean;
  setState: React.Dispatch<React.SetStateAction<GameState>>;
};

export const useGameClock = ({
  initialHours,
  speedIndex,
  isPaused,
  setState,
}: GameClockOptions) => {
  const accumulatorRef = useRef(
    createHourAccumulator(SPEEDS[0], initialHours),
  );

  useEffect(() => {
    const speed = SPEEDS[speedIndex] ?? SPEEDS[2];
    setState((prev) => {
      accumulatorRef.current.setSpeed(speed, prev.runtime.nowHours);
      return prev;
    });
    const interval = setInterval(() => {
      setState((prev) => {
        if (isPaused) {
          return prev;
        }
        const hoursToAdvance = accumulatorRef.current.tick(prev.runtime.nowHours);
        return hoursToAdvance > 0 ? advanceTime(prev, hoursToAdvance) : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [speedIndex, isPaused, setState]);
};
