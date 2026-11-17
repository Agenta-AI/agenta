import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import type {AppRevisionRow} from "./useAppRevisions"

// The diff editor loads only when a comparison opens.
const DiffView = dynamic(() => import("@agenta/ui/editor").then((module) => module.DiffView), {
    ssr: false,
})

const VersionCard = ({
    title,
    tone,
    row,
}: {
    title: string
    tone: "removed" | "added"
    row: AppRevisionRow
}) => (
    <section className="flex flex-col gap-2">
        <h3
            className={
                tone === "removed"
                    ? "m-0 text-sm font-semibold text-destructive"
                    : "m-0 text-sm font-semibold text-success"
            }
        >
            {title}
        </h3>
        <div
            className={
                tone === "removed"
                    ? "flex flex-col gap-2 rounded-lg border border-solid border-destructive/30 bg-destructive/5 p-3 text-[13px]"
                    : "flex flex-col gap-2 rounded-lg border border-solid border-success/30 bg-success/5 p-3 text-[13px]"
            }
        >
            <VariantDetailsWithStatus
                variant={{id: row.revisionId}}
                variantName={row.variantName}
                revision={row.version}
                showRevisionAsTag
                hideDiscard
            />
            <span className="flex items-center gap-1">
                <span className="font-medium text-foreground">Modified by:</span>
                <UserAuthorLabel userId={row.createdById} showYouLabel showAvatar fallback="—" />
            </span>
            <span>
                <span className="font-medium text-foreground">Created: </span>
                <FormattedDate date={row.createdAt} format="MMM D, YYYY, h:mm A" fallback="—" />
            </span>
        </div>
    </section>
)

/** The config of two revisions side by side, the older one as the original, as in the old app. */
export const CompareRevisionsDialog = ({
    revisions,
    onClose,
}: {
    revisions: readonly [AppRevisionRow, AppRevisionRow]
    onClose: () => void
}) => {
    const [original, modified] = [...revisions].sort(
        (a, b) =>
            Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? "") || a.version - b.version,
    )
    const originalEntity = useAtomValue(workflowMolecule.selectors.data(original.revisionId))
    const modifiedEntity = useAtomValue(workflowMolecule.selectors.data(modified.revisionId))
    const loaded = Boolean(originalEntity && modifiedEntity)

    return (
        <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent className="flex max-h-[85vh] w-[min(1080px,calc(100vw-32px))] max-w-none flex-col gap-4 sm:max-w-none">
                <DialogHeader>
                    <DialogTitle>Variant Comparison</DialogTitle>
                    <DialogDescription className="sr-only">
                        The configuration of two revisions, with the changes highlighted.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
                    <div className="flex shrink-0 flex-col gap-4 md:w-72">
                        <VersionCard title="Original Version" tone="removed" row={original} />
                        <VersionCard title="Modified Version" tone="added" row={modified} />
                    </div>
                    <div className="min-h-[320px] min-w-0 flex-1 overflow-auto rounded-lg border border-solid border-border">
                        {loaded ? (
                            <DiffView
                                language="json"
                                original={originalEntity?.data?.parameters ?? {}}
                                modified={modifiedEntity?.data?.parameters ?? {}}
                                computeOnMountOnly
                            />
                        ) : (
                            <p className="m-0 p-4 text-sm text-muted-foreground">Loading…</p>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
