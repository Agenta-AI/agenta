import type {SessionView} from "./types"

/** The session views in tab order, with their labels. */
export const SESSION_TABS: {key: SessionView; label: string}[] = [
    {key: "annotate", label: "Annotate"},
    {key: "list", label: "All annotations"},
    {key: "configuration", label: "Configuration"},
]
