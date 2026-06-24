import {atom} from "jotai"

/**
 * Run id whose "Edit evaluation" drawer is currently open (null = closed).
 *
 * Shared so every trigger opens the SINGLE drawer instance rendered at the run-details
 * page root (always mounted, so the trigger works from any tab):
 *   - the run-header actions dropdown (`RunActionsDropdown`, visible on all tabs),
 *   - the Configuration → General section's Edit button,
 *   - the Configuration → Evaluators "Add evaluator" button.
 */
export const editEvaluationDrawerRunIdAtom = atom<string | null>(null)
