import {useState} from "react"

import {evaluationRunQueryAtomFamily, type RunHeader} from "@agenta/entities/evaluationRun"
import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Badge, Button} from "@agenta/ui/ui"
import {PencilSimpleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../../context/useProjectPermission"
import {RunStatusTag} from "../overview/RunStatusTag"

import {RunRenameForm} from "./RunRenameForm"
import {useRenameRun} from "./useRenameRun"

const MISSING = "—"

const CREATED_AT = new Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeStyle: "short"})

function formatCreatedAt(value: string | null): string {
    const date = value ? new Date(value) : null
    return date && !Number.isNaN(date.getTime()) ? CREATED_AT.format(date) : MISSING
}

/**
 * The run's identity: status, name, description, who made it and when, tags and the run id.
 * A reader who may edit evaluation runs gets Edit, which swaps the card for the rename form.
 */
export const RunSummaryCard = ({
    projectId,
    runId,
    header,
}: {
    projectId: string
    runId: string
    header: RunHeader
}) => {
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data
    // The API refuses to edit a closed run, so the button is not offered on one.
    const canEdit =
        useProjectPermission(projectId, "edit_evaluation_runs") && !header.flags.isClosed
    const {save, saving} = useRenameRun(projectId, runId)
    const [editing, setEditing] = useState(false)

    const name = run?.name?.trim() ?? ""
    const tags = run?.tags ?? []

    return (
        <section
            aria-label="Run summary"
            className="box-border flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-card p-4"
        >
            {editing ? (
                <RunRenameForm
                    initialName={name}
                    initialDescription={run?.description ?? ""}
                    saving={saving}
                    onSave={async (nextName, nextDescription) => {
                        const saved = await save(nextName, nextDescription)
                        if (saved) setEditing(false)
                        return saved
                    }}
                    onCancel={() => setEditing(false)}
                />
            ) : (
                <>
                    <div className="flex items-center justify-between gap-2">
                        <RunStatusTag status={header.status} />
                        {canEdit ? (
                            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                                <PencilSimpleIcon aria-hidden />
                                Edit
                            </Button>
                        ) : null}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <h2 className="m-0 break-words text-base font-semibold text-foreground">
                            {name || MISSING}
                        </h2>
                        {header.description ? (
                            <p className="m-0 break-words text-sm text-muted-foreground">
                                {header.description}
                            </p>
                        ) : null}
                    </div>
                    <p className="m-0 text-sm text-muted-foreground">
                        {formatCreatedAt(header.createdAt)} by{" "}
                        <UserAuthorLabel userId={header.createdById} fallback={MISSING} />
                    </p>
                    {tags.length > 0 ? (
                        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                            {tags.map((tag) => (
                                <li key={tag}>
                                    <Badge variant="outlined">{tag}</Badge>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <div className="flex min-w-0 items-center gap-1">
                        <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                            {runId}
                        </code>
                        <CopyButton
                            text={runId}
                            icon
                            buttonText={null}
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Copy run ID"
                            successMessage="Run ID copied"
                        />
                    </div>
                </>
            )}
        </section>
    )
}
