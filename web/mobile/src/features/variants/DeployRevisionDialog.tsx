import {useState} from "react"

import {appEnvironmentsLoadableAtomFamily} from "@agenta/entities/environment"
// The narrow path: the `variant` barrel also carries the revision drawer.
import VariantDetailsWithStatus from "@agenta/entity-ui/variant-details"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {CommitMessageInput, Tag} from "@agenta/ui/components/presentational"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    RadioGroup,
    RadioGroupItem,
    Skeleton,
} from "@agenta/ui/ui"
import {Rocket} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import type {AppRevisionRow} from "./useAppRevisions"
import {useDeployRevision} from "./useDeploymentWrites"

/** What the dialog needs of a revision: the variants list and the playground both supply it. */
export type DialogRevision = Pick<
    AppRevisionRow,
    "revisionId" | "variantName" | "version" | "variantId" | "variantSlug"
>

/**
 * Deploy one revision to an environment the reader picks. Mount it only while a revision is
 * chosen: each mount starts with nothing picked and an empty note.
 */
export const DeployRevisionDialog = ({
    row,
    appId,
    appSlug,
    onClose,
}: {
    row: DialogRevision
    appId: string
    appSlug: string | null
    onClose: () => void
}) => {
    const environments = useAtomValue(appEnvironmentsLoadableAtomFamily(appId))
    // Beta developer mode shows the current variant as /w does: its name and a version tag.
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const deploy = useDeployRevision()
    const [picked, setPicked] = useState<string | null>(null)
    const [note, setNote] = useState("")
    const [pending, setPending] = useState(false)

    const choices = environments.data.map((environment) => ({
        key: environment.slug || environment.name,
        name: environment.name,
        variantName: environment.deployedVariantName,
        revision: environment.revision,
        current: environment.deployedVariantName
            ? `${environment.deployedVariantName}${environment.revision ? ` v${environment.revision}` : ""}`
            : "",
    }))
    const choice = choices.find((entry) => entry.key === picked)

    const submit = async () => {
        if (!choice) return
        setPending(true)
        const ok = await deploy({
            target: {
                revisionId: row.revisionId,
                revisionVersion: row.version,
                appId,
                appSlug,
                variantId: row.variantId || null,
                variantSlug: row.variantSlug,
            },
            environmentSlug: choice.key,
            successText: `Published ${row.variantName} to ${choice.name}`,
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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Deploy variant</DialogTitle>
                    <DialogDescription>
                        Select an environment to deploy {row.variantName} v{row.version}
                    </DialogDescription>
                </DialogHeader>

                {environments.isPending ? (
                    <div className="flex flex-col gap-2" aria-label="Loading environments">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                ) : environments.isError ? (
                    <p className="m-0 text-sm text-destructive">Couldn't load the environments</p>
                ) : choices.length === 0 ? (
                    <p className="m-0 text-sm text-muted-foreground">No environments</p>
                ) : (
                    <RadioGroup
                        value={picked ?? ""}
                        onValueChange={setPicked}
                        aria-label="Environment"
                    >
                        <div className="grid grid-cols-[1fr_1fr] gap-x-3 px-1 text-xs text-muted-foreground">
                            <span>Environment</span>
                            <span>Current variant</span>
                        </div>
                        {choices.map((entry) => (
                            <label
                                key={entry.key}
                                className="grid cursor-pointer grid-cols-[1fr_1fr] items-center gap-x-3 rounded-md border border-solid border-border px-3 py-2"
                            >
                                <span className="flex items-center gap-2">
                                    <RadioGroupItem value={entry.key} aria-label={entry.name} />
                                    <Tag env={entry.name} />
                                </span>
                                {beta && entry.variantName ? (
                                    <VariantDetailsWithStatus
                                        className="min-w-0 justify-start text-sm"
                                        variantName={entry.variantName}
                                        revision={entry.revision}
                                        showRevisionAsTag
                                        hideDiscard
                                        showLatestTag={false}
                                    />
                                ) : (
                                    <span className="truncate text-sm text-muted-foreground">
                                        {entry.current}
                                    </span>
                                )}
                            </label>
                        ))}
                    </RadioGroup>
                )}

                <CommitMessageInput value={note} onChange={setNote} label="Notes" />

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button disabled={!choice || pending} onClick={() => void submit()}>
                        <Rocket aria-hidden size={14} />
                        Deploy
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
