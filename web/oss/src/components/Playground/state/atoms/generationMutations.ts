import {getDefaultStore} from "jotai"

import {addEmptyChatTurnMutationAtom} from "./mutations/chat/addEmptyTurn"
import {ensureInitialChatRowAtom} from "./mutations/chat/ensureInitialRow"
import {ensureChatSessionsForDisplayedRevisionsAtom} from "./mutations/chat/ensureSessions"
import {normalizeComparisonChatTurnsMutationAtom} from "./mutations/chat/normalizeComparison"
import {pruneEmptyNextTurnsForRevisionMutationAtom} from "./mutations/chat/prune"
import {pruneLogicalTurnIndexForDisplayedVariantsMutationAtom} from "./mutations/chat/pruneLogicalIndexForDisplayed"
import {pruneTurnsAfterLogicalIdMutationAtom} from "./mutations/chat/pruneTurnsAfterLogical"
import {regenerateSingleModeChatFromActiveRevisionAtom} from "./mutations/chat/regenerateSingle"
import {runAllChatForDisplayedVariantsMutationAtom} from "./mutations/chat/runAllForDisplayed"
import {deleteLogicalTurnAcrossRevisionsMutationAtom} from "./mutations/deleteLogicalTurn"
import {addGenerationInputRowMutationAtom} from "./mutations/input/addInputRow"
import {addVariablesInputRowMutationAtom} from "./mutations/input/addVariablesInputRow"
import {deleteGenerationInputRowMutationAtom} from "./mutations/input/deleteInputRow"
import {duplicateGenerationInputRowMutationAtom} from "./mutations/input/duplicateInputRow"
import {ensureInitialInputRowAtom} from "./mutations/input/ensureInitialRow"
import {optionsAtom} from "./mutations/rerun/optionsAtom"
import {runSingleCellRerunMutationAtom} from "./mutations/rerun/runSingleCellRerun"
import {forceSyncPromptVariablesToNormalizedAtom} from "./mutations/sync/forceSyncPromptVariables"
import {syncPromptVariablesToNormalizedAtom} from "./mutations/sync/syncPromptVariables"
import {loadTestsetNormalizedMutationAtom} from "./mutations/testset/loadNormalized"
// orchestration: central run lifecycle control
import {runLifecycleOrchestratorAtom} from "./orchestration/runLifecycle"

// watchers: side-effect imports to attach onMount handlers
import "./watchers/ensureInitial"
import "./watchers/ensureInputs"
import "./watchers/sync"
import "./watchers/syncMapping"
import "./watchers/modeReset"

// Force-mount the orchestrator so its onMount side-effects activate without
// needing a component to call useAtom on it.
try {
    if (typeof window !== "undefined") {
        const store = getDefaultStore()
        // Subscribe to the atom to ensure onMount runs on the active store.
        // Keep the subscription alive for the module lifetime.
        store.sub(runLifecycleOrchestratorAtom, () => {})
    }
} catch {}

export {deleteLogicalTurnAcrossRevisionsMutationAtom}
export {pruneEmptyNextTurnsForRevisionMutationAtom}
export {deleteGenerationInputRowMutationAtom}
export {ensureChatSessionsForDisplayedRevisionsAtom}
export {ensureInitialChatRowAtom}
export {ensureInitialInputRowAtom}
export {addGenerationInputRowMutationAtom}
export {duplicateGenerationInputRowMutationAtom}
export {addVariablesInputRowMutationAtom}
export {loadTestsetNormalizedMutationAtom}
export {syncPromptVariablesToNormalizedAtom}
export {forceSyncPromptVariablesToNormalizedAtom}
export {optionsAtom}
export {runSingleCellRerunMutationAtom}
export {addEmptyChatTurnMutationAtom}
export {pruneLogicalTurnIndexForDisplayedVariantsMutationAtom}
export {pruneTurnsAfterLogicalIdMutationAtom}
export {regenerateSingleModeChatFromActiveRevisionAtom}
export {runAllChatForDisplayedVariantsMutationAtom}
export {normalizeComparisonChatTurnsMutationAtom}
