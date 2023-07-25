import { EvaluationType } from "../enums";

export const renameVariables = (name: string) => {
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");
};

export const renameVariablesCapitalizeAll = (name: string) => {
  const words = name.split("_");
  for (let i = 0; i < words.length; i++) {
    words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1);
  }
  return words.join(" ");
};

export const EvaluationTypeLabels: Record<EvaluationType, string> = {
  [EvaluationType.auto_exact_match]: "Exact Match",
  [EvaluationType.auto_ai_critique]: "AI Critic",
  [EvaluationType.human_a_b_testing]: "A/B testing",
  [EvaluationType.human_scoring]: "Scoring single variant",
};
