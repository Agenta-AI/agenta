import {useEffect, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    SimpleTooltip,
    Spinner,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import type {ColumnEdit} from "./useTestsetEditor"

/** The column step that is open: add a column, or rename or delete one. */
export type ColumnDialogStep =
    | {kind: "add"}
    | {kind: "rename"; columnKey: string}
    /** `groupColumns` is set for a group header: the columns under it, deleted together. */
    | {kind: "delete"; columnKey: string; groupColumns?: string[]}

const SAVES_VERSION = "This saves a new version of the test set right away."
const NAME_TIP =
    "Tip: Use dot notation to create nested columns. For example, parent.child creates a child column under the parent group."

const refusalText = (result: Exclude<ColumnEdit, {ok: true}>, name: string): string | null => {
    if ("message" in result) return result.message
    if (result.reason === "empty") return "Column name cannot be empty"
    if (result.reason === "duplicate") return `Column "${name}" already exists`
    return null
}

/**
 * The add, rename and delete column steps. On a saved test set each one saves a new version as
 * soon as it is confirmed, so the step says so and its button names the save. On a new test set
 * nothing is saved until the first commit.
 *
 * `onDone` gets the saved version to open, or null on a new test set.
 */
export const ColumnDialog = ({
    step,
    savesVersion,
    onClose,
    onSubmit,
    onDone,
}: {
    step: ColumnDialogStep | null
    savesVersion: boolean
    onClose: () => void
    /** Runs the change. Gets the typed name; a delete gets the column name. */
    onSubmit: (name: string) => Promise<ColumnEdit>
    onDone: (revisionId: string | null) => void
}) => {
    const [name, setName] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    useEffect(() => {
        if (!step) return
        setName(step.kind === "rename" ? step.columnKey : "")
        setError(null)
    }, [step])

    if (!step) return null

    const isDelete = step.kind === "delete"
    const title =
        step.kind === "add"
            ? "Add Column"
            : step.kind === "rename"
              ? "Rename Column"
              : step.groupColumns
                ? "Delete Group"
                : "Delete Column"
    const verb = step.kind === "add" ? "Add" : step.kind === "rename" ? "Rename" : "Delete"
    const confirmLabel = savesVersion ? `${verb} and save` : verb
    const description = isDelete
        ? step.groupColumns
            ? `Are you sure you want to delete the group "${step.columnKey}" and its ${step.groupColumns.length} columns? This will remove them from all testcases.`
            : `Are you sure you want to delete the column "${step.columnKey}"? This will remove the column from all testcases.`
        : savesVersion
          ? SAVES_VERSION
          : null

    const submit = async () => {
        const typed = isDelete ? step.columnKey : name.trim()
        setPending(true)
        setError(null)
        try {
            const result = await onSubmit(typed)
            if (result.ok) {
                onDone(result.revisionId)
                return
            }
            if (result.reason === "unchanged") {
                onClose()
                return
            }
            if (step.kind === "rename" && result.reason === "empty") {
                onClose()
                return
            }
            setError(refusalText(result, typed))
        } finally {
            setPending(false)
        }
    }

    const canSubmit = !pending && (isDelete || name.trim().length > 0 || step.kind === "rename")

    return (
        <Dialog open onOpenChange={(next) => (next || pending ? undefined : onClose())}>
            <DialogContent
                // Radix links the description by itself; with none, say so to keep it quiet.
                {...(description ? {} : {"aria-describedby": undefined})}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description ? <DialogDescription>{description}</DialogDescription> : null}
                </DialogHeader>
                {isDelete ? (
                    savesVersion ? (
                        <p className="text-sm text-muted-foreground">{SAVES_VERSION}</p>
                    ) : null
                ) : (
                    <form
                        className="flex flex-col gap-2"
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (canSubmit) void submit()
                        }}
                    >
                        <Label htmlFor="column-name">Column name:</Label>
                        <Input
                            id="column-name"
                            autoFocus
                            placeholder="Enter column name"
                            value={name}
                            disabled={pending}
                            onChange={(event) => {
                                setName(event.target.value)
                                setError(null)
                            }}
                        />
                        {step.kind === "rename" ? (
                            <p className="text-xs text-muted-foreground">{NAME_TIP}</p>
                        ) : null}
                    </form>
                )}
                {error ? (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        variant={isDelete ? "destructive" : "default"}
                        disabled={!canSubmit}
                        onClick={() => void submit()}
                    >
                        {pending ? <Spinner aria-hidden /> : null}
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/**
 * The "Add column" button. It is off while rows have unsaved edits, and its tooltip says why.
 */
export const AddColumnButton = ({
    blockedReason,
    onClick,
}: {
    blockedReason: string | null
    onClick: () => void
}) => (
    <SimpleTooltip title={blockedReason ?? "Add column"}>
        <span className="inline-flex">
            <Button
                variant="outline"
                size="sm"
                disabled={blockedReason !== null}
                aria-label="Add column"
                onClick={onClick}
            >
                <Plus aria-hidden size={14} />
                Add column
            </Button>
        </span>
    </SimpleTooltip>
)
