import type {SessionView} from "./types"

/** The session views in tab order, with their labels. */
export const SESSION_TABS: {key: SessionView; label: string}[] = [
    {key: "annotate", label: "Annotate"},
    {key: "list", label: "All Annotations"},
    {key: "configuration", label: "Configuration"},
]
