import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

export type EmbedResolutionViewMode = "unresolved" | "resolved"

// UI-only toggle:
// - `unresolved`: editable authoring view (draft/source of truth for commit)
// - `resolved`: read-only resolved view (for inspection and run parity)
export const playgroundEmbedResolutionViewModeAtom = atomWithStorage<EmbedResolutionViewMode>(
    "agenta:playground:embed-resolution-view",
    "unresolved",
)

export const playgroundResolvedViewEnabledAtom = atom(
    (get) => get(playgroundEmbedResolutionViewModeAtom) === "resolved",
)
