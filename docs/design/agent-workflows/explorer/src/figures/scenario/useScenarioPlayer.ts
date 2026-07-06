import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "../../model/types";

const STEP_DURATION_MS = 2500;

export function useScenarioPlayer(scenario: Scenario) {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false); // never autoplay on mount
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stepCount = scenario.steps.length;
  const isLastStep = stepIndex >= stepCount - 1;

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.max(0, Math.min(stepCount - 1, index)));
    },
    [stepCount],
  );

  const next = useCallback(() => goTo(stepIndex + 1), [goTo, stepIndex]);
  const prev = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex]);

  const play = useCallback(() => {
    if (isLastStep) setStepIndex(0);
    setIsPlaying(true);
  }, [isLastStep]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => {
      setStepIndex((current) => {
        if (current >= stepCount - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, STEP_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, stepIndex, stepCount]);

  // Reset to step 0 whenever the scenario itself changes (e.g. tabs in §4).
  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, [scenario.id]);

  return {
    stepIndex,
    step: scenario.steps[stepIndex],
    previousPayload: stepIndex === 0 ? {} : scenario.steps[stepIndex - 1].payload,
    isPlaying,
    isFirstStep: stepIndex === 0,
    isLastStep,
    next,
    prev,
    goTo,
    togglePlay,
  };
}
