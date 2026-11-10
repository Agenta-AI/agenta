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
    /** `columnKeys` are the row keys the delete removes; `isGroup` for a group header. */
    | {kind: "delete"; columnKey: string; columnKeys: string[]; isGroup: boolean}

const NAME_TIP =
    "Tip: Use dot notation to create nested columns. For example, parent.child creates a child column under the parent group."

const refusalText = (result: Exclude<ColumnEdit, {ok: true}>, name: string): string | null => {
    if ("message" in result) return result.message
    if (result.reason === "empty") return "Column name cannot be empty"
    if (result.reason === "duplicate") return `Column "${name}" already exists`
    return null
}

/**
 * The add, rename and delete column steps. A change waits with the row edits for the next
 * commit, and Discard drops it.
 */
export const ColumnDialog = ({
    step,
    onClose,
    onSubmit,
    onDone,
}: {
    step: ColumnDialogStep | null
    onClose: () => void
    /** Runs the change. Gets the typed name; a delete gets the column name. */
    onSubmit: (name: string) => Promise<ColumnEdit>
    onDone: () => void
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
              : step.isGroup
                ? "Delete Group"
                : "Delete Column"
    const confirmLabel = step.kind === "add" ? "Add" : step.kind === "rename" ? "Rename" : "Delete"
    const description = isDelete
        ? step.isGroup
            ? `Are you sure you want to delete the group "${step.columnKey}" and every column in it? This will remove them from all testcases.`
            : `Are you sure you want to delete the column "${step.columnKey}"? This will remove the column from all testcases.`
        : null

    const submit = async () => {
        const typed = isDelete ? step.columnKey : name.trim()
        setPending(true)
        setError(null)
        try {
            const result = await onSubmit(typed)
            if (result.ok) {
                onDone()
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
                {isDelete ? null : (
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
 * The "Add column" button. It is off while a save runs, and its tooltip says why. `compact` is
 * the icon-only form for the table header, as in the old app.
 */
export const AddColumnButton = ({
    blockedReason,
    compact = false,
    onClick,
}: {
    blockedReason: string | null
    compact?: boolean
    onClick: () => void
}) => (
    <SimpleTooltip title={blockedReason ?? "Add column"}>
        <span className="inline-flex">
            <Button
                variant={compact ? "ghost" : "outline"}
                size={compact ? "icon-xs" : "sm"}
                disabled={blockedReason !== null}
                aria-label="Add column"
                onClick={(event) => {
                    event.stopPropagation()
                    onClick()
                }}
            >
                <Plus aria-hidden size={14} />
                {compact ? null : "Add column"}
            </Button>
        </span>
    </SimpleTooltip>
)
