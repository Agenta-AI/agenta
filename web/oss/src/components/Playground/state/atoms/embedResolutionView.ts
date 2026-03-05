import {atom} from "jotai"

export type EmbedResolutionViewMode = "unresolved" | "resolved"

// UI-only toggle:
// - `unresolved`: editable authoring view (draft/source of truth for commit)
// - `resolved`: read-only resolved view (for inspection and run parity)
export const playgroundEmbedResolutionViewModeAtom = atom<EmbedResolutionViewMode>("unresolved")

export const playgroundResolvedViewEnabledAtom = atom(
    (get) => get(playgroundEmbedResolutionViewModeAtom) === "resolved",
)
