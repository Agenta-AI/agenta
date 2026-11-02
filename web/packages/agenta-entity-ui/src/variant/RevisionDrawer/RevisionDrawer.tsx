import {lazy, Suspense, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {Sheet, SheetContent, Skeleton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {RevisionDetails} from "./RevisionDetails"
import {RevisionDrawerHeader} from "./RevisionDrawerHeader"
import {RevisionDrawerSkeleton} from "./RevisionDrawerSkeleton"
import type {RevisionDrawerKind, RevisionDrawerProps} from "./types"

// The config pane wraps the whole drill-in editor. It loads when a revision first renders, so
// importing this package entry costs nothing until a user opens the drawer.
const RevisionConfigView = lazy(() =>
    import("./RevisionConfigView").then((m) => ({default: m.RevisionConfigView})),
)

const RevisionDrawerBody = ({revisionId, kind}: {revisionId: string; kind: RevisionDrawerKind}) => {
    const query = useAtomValue(workflowMolecule.atoms.query(revisionId))

    if (query.isError) {
        return (
            <LoadError
                className="m-4"
                title="Could not load this revision"
                onRetry={() => void query.refetch()}
            />
        )
    }
    if (query.isPending) return <RevisionDrawerSkeleton />
    if (!query.data) {
        return (
            <p className="text-muted-foreground m-0 p-6 text-center text-sm">
                This revision is no longer available.
            </p>
        )
    }
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            <div className="min-w-0 flex-1 p-4 md:overflow-y-auto">
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                    <RevisionConfigView revisionId={revisionId} kind={kind} />
                </Suspense>
            </div>
            <div className="shrink-0 border-0 border-t border-solid border-border p-4 md:w-72 md:overflow-y-auto md:border-t-0 md:border-l">
                <RevisionDetails revisionId={revisionId} kind={kind} />
            </div>
        </div>
    )
}

/** A read-only view of one workflow revision in a right-side sheet. The host owns open state. */
export const RevisionDrawer = ({
    revisionId,
    kind,
    onClose,
    navigationIds,
    onNavigate,
    actions,
}: RevisionDrawerProps) => {
    // Keep the last revision drawn while the sheet slides out after a close.
    const shownIdRef = useRef(revisionId)
    if (revisionId) shownIdRef.current = revisionId
    const shownId = shownIdRef.current

    return (
        <Sheet open={revisionId !== null} onOpenChange={(open) => !open && onClose()}>
            <SheetContent
                side="right"
                aria-describedby={undefined}
                className="overflow-hidden max-sm:inset-0 max-sm:w-full max-sm:rounded-none sm:w-[min(1100px,92vw)] sm:max-w-none"
            >
                {shownId ? (
                    <>
                        <RevisionDrawerHeader
                            revisionId={shownId}
                            kind={kind}
                            navigationIds={navigationIds}
                            onNavigate={onNavigate}
                            actions={actions}
                        />
                        <RevisionDrawerBody revisionId={shownId} kind={kind} />
                    </>
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
