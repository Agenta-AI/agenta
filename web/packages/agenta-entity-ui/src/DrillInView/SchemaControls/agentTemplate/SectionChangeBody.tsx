/**
 * SectionChangeBody
 *
 * What a drawer-backed config section (Model & harness / Advanced) shows INLINE when it has
 * uncommitted changes: **its own controls, narrowed to the properties that changed**, plus a link to
 * the drawer for everything else.
 *
 * This is the same affordance as the Model & harness "Connect key" state — show the control that
 * owns the thing needing attention, not a description of it, and not the whole drawer. "Needs a key"
 * and "changed since the commit" are one pattern with different filters; only the filter differs.
 *
 * Deliberately NOT a second rendering of the change. Earlier attempts at a summary card and a
 * `before → after` list both re-rendered values the real controls already render (and did it worse —
 * a truncated `["Terminal","Write",…]` where the control shows clean lines), and would have to be
 * kept in sync with them forever. Rows already declare their `path`, so a filter is the whole
 * mechanism.
 *
 * `children` must be the body COMPONENT, not pre-built JSX from a `useModelHarness` call made
 * higher up: that hook reads these filters itself, and React resolves context at the reader's
 * position — so it has to run beneath these providers or it silently ignores them.
 */
import type {ReactNode} from "react"

import {ChangedPathsProvider, type ChangedPaths} from "../../../drawers/shared/ChangedPathsContext"
import {FocusPathsProvider} from "../../../drawers/shared/FocusPathsContext"
import {SectionQuickAction} from "../SectionQuickAction"

export interface SectionChangeBodyProps {
    /** The section's body component — rendered beneath the filters below. */
    children: ReactNode
    /** The changed property paths to narrow to. */
    paths: string[]
    /** Opens the section's full drawer. */
    onOpenDetails: () => void
    /** Marks + per-row revert for the rows that survive the filter. */
    changes: ChangedPaths
    disabled?: boolean
}

export function SectionChangeBody({
    children,
    paths,
    onOpenDetails,
    changes,
    disabled,
}: SectionChangeBodyProps) {
    return (
        <SectionQuickAction
            onOpenDetails={onOpenDetails}
            detailsLabel="Detailed configuration"
            disabled={disabled}
        >
            <ChangedPathsProvider changes={changes}>
                <FocusPathsProvider paths={paths}>{children}</FocusPathsProvider>
            </ChangedPathsProvider>
        </SectionQuickAction>
    )
}
