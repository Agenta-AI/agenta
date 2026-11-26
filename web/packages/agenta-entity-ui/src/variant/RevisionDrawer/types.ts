import type {ReactNode} from "react"

/** Which list opened the drawer. It sets the title and the detail rows; the data is the same. */
export type RevisionDrawerKind = "variant" | "deployment" | "evaluator"

export interface RevisionDrawerProps {
    /** The revision to show. null = closed. */
    revisionId: string | null
    kind: RevisionDrawerKind
    onClose: () => void
    /** Ids for prev/next, in list order. Arrows show only when there are 2 or more. */
    navigationIds?: readonly string[]
    onNavigate?: (revisionId: string) => void
    /** Header-right slot. The host owns every write (Deploy, Revert). */
    actions?: ReactNode
}
