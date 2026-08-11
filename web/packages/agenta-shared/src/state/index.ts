/**
 * Shared state atoms and Jotai recipes for Agenta packages.
 */

export {projectIdAtom, setProjectIdAtom} from "./project"
export {sessionAtom, setSessionAtom} from "./session"
export {userAtom, setUserAtom} from "./user"
export {simulatedAgentRunAtomFamily} from "./simulatedAgentRun"
export type {SimulatedAgentRunRequest} from "./simulatedAgentRun"
export {openAgentConfigSectionAtom} from "./openConfigSection"
export type {AgentConfigSection} from "./openConfigSection"
export {agentSelfCommitSignalAtom} from "./agentCommitSignal"
export type {AgentSelfCommitSignal} from "./agentCommitSignal"
export {draftConfigChangeSignalAtom} from "./draftConfigChangeSignal"
export type {DraftConfigChangeSignal} from "./draftConfigChangeSignal"
export {providerKeyAddedSignalAtom} from "./providerKeyAddedSignal"
export type {ProviderKeyAddedSignal} from "./providerKeyAddedSignal"
export {atomWithRefresh} from "jotai/utils"
export {
    atomWithCompare,
    atomWithToggle,
    atomWithToggleAndStorage,
    atomWithListeners,
    atomWithBroadcast,
    atomWithDebounce,
    atomWithRefreshAndDefault,
} from "./recipes"
export type {DebouncedAtomBundle} from "./recipes"

// Debug / logging utilities
export {logAtom} from "./logAtom"
export {devLog} from "./devLog"

// Storage adapters for atomWithStorage
export {stringStorage} from "./stringStorage"

// Boot-phase idle gate for non-critical bootstrap queries
export {idleReadyAtom} from "./idleReady"
