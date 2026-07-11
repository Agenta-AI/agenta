import type { ScenarioStep } from "../../model/types";

export interface StepControlsProps {
  steps: ScenarioStep[];
  stepIndex: number;
  isPlaying: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onGoTo: (index: number) => void;
}

export function StepControls({
  steps,
  stepIndex,
  isPlaying,
  isFirstStep,
  isLastStep,
  onPrev,
  onNext,
  onTogglePlay,
  onGoTo,
}: StepControlsProps) {
  return (
    <div className="step-controls">
      <button onClick={onPrev} disabled={isFirstStep} aria-label="Previous step">
        &larr; Prev
      </button>
      <button onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? "Pause" : isLastStep ? "Replay" : "Play"}
      </button>
      <button onClick={onNext} disabled={isLastStep} aria-label="Next step">
        Next &rarr;
      </button>
      <div className="step-dots" role="tablist" aria-label="Scenario steps">
        {steps.map((step, index) => (
          <button
            key={index}
            className="step-dot"
            data-active={index === stepIndex}
            title={step.title}
            aria-label={`Step ${index + 1}: ${step.title}`}
            aria-selected={index === stepIndex}
            role="tab"
            onClick={() => onGoTo(index)}
          />
        ))}
      </div>
    </div>
  );
}
