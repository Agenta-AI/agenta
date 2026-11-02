import {useState} from "react"

import {useSettledValue} from "@agenta/shared/hooks"
import {CommitMessageInput, FormattedDate} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    RadioGroup,
    RadioGroupItem,
    Skeleton,
} from "@agenta/ui/ui"

import {useAppRevisions, type AppRevisionRow} from "./useAppRevisions"
import {useDeployRevision} from "./useDeploymentWrites"

/**
 * Deploy any revision of the app to one environment. The reader picks the revision from a list
 * that this dialog searches by itself, so a term typed elsewhere never filters it.
 * Mount it only while it is open.
 */
export const DeployToEnvironmentDialog = ({
    projectId,
    appId,
    appSlug,
    environment,
    onClose,
}: {
    projectId: string
    appId: string
    appSlug: string | null
    environment: {
        slug: string
        name: string
        deployedRevisionId: string | null
        /** "name v2", or null when nothing is deployed. */
        deployedLabel: string | null
    }
    onClose: () => void
}) => {
    const [search, setSearch] = useState("")
    const term = useSettledValue(search).trim()
    const revisions = useAppRevisions({projectId, appId, search: term})
    const deploy = useDeployRevision()
    const [pickedId, setPickedId] = useState<string | null>(null)
    const [pickedRow, setPickedRow] = useState<AppRevisionRow | null>(null)
    const [note, setNote] = useState("")
    const [pending, setPending] = useState(false)

    const alreadyDeployed = pickedRow?.revisionId === environment.deployedRevisionId

    const submit = async () => {
        if (!pickedRow) return
        setPending(true)
        const ok = await deploy({
            target: {
                revisionId: pickedRow.revisionId,
                revisionVersion: pickedRow.version,
                appId,
                appSlug,
                variantId: pickedRow.variantId || null,
                variantSlug: pickedRow.variantSlug,
            },
            environmentSlug: environment.slug || environment.name,
            successText: `Deployed to ${environment.name} successfully`,
            note,
        })
        setPending(false)
        if (ok) onClose()
    }

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Deploy {environment.name}</DialogTitle>
                    <DialogDescription>
                        {pickedRow
                            ? `This will deploy the following revision to ${environment.name}.`
                            : `Select a revision from the table to deploy to ${environment.name}.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid min-h-0 grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-3">
                        {pickedRow ? (
                            <div className="flex flex-col gap-1 text-sm">
                                <span>
                                    {environment.deployedLabel ?? "No deployment"} →{" "}
                                    {pickedRow.variantName} v{pickedRow.version}
                                </span>
                                {pickedRow.model ? (
                                    <span className="text-muted-foreground">
                                        Model: {pickedRow.model}
                                    </span>
                                ) : null}
                                {alreadyDeployed ? (
                                    <span className="text-colorWarningText">
                                        This revision is already deployed to {environment.name}.
                                    </span>
                                ) : null}
                            </div>
                        ) : null}
                        <CommitMessageInput value={note} onChange={setNote} label="Deploy message" />
                    </div>

                    <div className="flex min-w-0 flex-col gap-2">
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search revisions..."
                            aria-label="Search revisions"
                        />
                        <div className="max-h-64 overflow-y-auto">
                            {revisions.isPending ? (
                                <Skeleton className="h-24 w-full" />
                            ) : revisions.isError ? (
                                <p className="m-0 text-sm text-destructive">
                                    Couldn't load the revisions
                                </p>
                            ) : revisions.rows.length === 0 ? (
                                <p className="m-0 text-sm text-muted-foreground">
                                    No variants available
                                </p>
                            ) : (
                                <RadioGroup
                                    value={pickedId ?? ""}
                                    onValueChange={(next) => {
                                        setPickedId(next)
                                        setPickedRow(
                                            revisions.rows.find((row) => row.revisionId === next) ??
                                                null,
                                        )
                                    }}
                                    aria-label="Revision"
                                >
                                    {revisions.rows.map((row) => (
                                        <label
                                            key={row.revisionId}
                                            className="flex cursor-pointer items-center gap-2 rounded-md border border-solid border-border px-3 py-2 text-sm"
                                        >
                                            <RadioGroupItem
                                                value={row.revisionId}
                                                aria-label={`${row.variantName} v${row.version}`}
                                            />
                                            <span className="min-w-0 flex-1 truncate">
                                                {row.variantName} v{row.version}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                <FormattedDate
                                                    date={row.createdAt}
                                                    format="MMM D, YYYY"
                                                    fallback="—"
                                                />
                                            </span>
                                        </label>
                                    ))}
                                </RadioGroup>
                            )}
                        </div>
                        {revisions.hasMore ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={revisions.isLoadingMore}
                                onClick={() => void revisions.loadMore()}
                            >
                                Load more
                            </Button>
                        ) : null}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!pickedRow || alreadyDeployed || pending}
                        onClick={() => void submit()}
                    >
                        Deploy
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
