/**
 * The two file-access dialogs of an HTML app. {@link AccessQuestion} asks about what the app just
 * tried (reading, or changing files); {@link GrantSheet} is the ⋯ "File access…" setting with the
 * full choice. Both can be confined to the Files pane through `container`.
 */
import {useState, type ReactNode} from "react"

import {type AppAccess} from "@agenta/entities/drive"
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
} from "@agenta/ui/ui"

/** How a stored level reads in the UI; null is "never answered". */
export const accessLabel = (level: AppAccess | null): string =>
    level === "read-write"
        ? "Read and write"
        : level === "read"
          ? "Read"
          : level === "none"
            ? "None"
            : "Not set"

const FolderCode = ({dir}: {dir: string}) => (
    <code className="rounded bg-colorFillSecondary px-1 py-0.5 text-[11px] text-colorText">
        {dir || "/"}
    </code>
)

const TRUST_NOTE =
    "The app never receives your login. Agenta makes the file calls for it. Only allow apps you trust: the app's code can read these files and may be able to send what it reads outside Agenta."

/** The dialog frame both share: page-modal, or confined to `container` with the page live. */
const AccessDialog = ({
    open,
    container,
    onDismiss,
    showCloseButton,
    children,
}: {
    open: boolean
    container?: HTMLElement | null
    onDismiss: () => void
    showCloseButton: boolean
    children: ReactNode
}) => (
    <Dialog open={open} modal={!container} onOpenChange={(next) => (next ? undefined : onDismiss())}>
        <DialogContent
            container={container}
            contained={!!container}
            className="max-w-sm gap-4 text-xs"
            showCloseButton={showCloseButton}
        >
            {children}
        </DialogContent>
    </Dialog>
)

export interface AccessQuestionProps {
    open: boolean
    /** App name from the manifest, else the folder name. */
    appName: string
    /** App dir as presented to the user. */
    dir: string
    /** What the app just tried: reading files, or changing them. */
    need: "read" | "write"
    /** A positioned pane to confine the dialog to; the rest of the page stays live. */
    container?: HTMLElement | null
    /** Allow (true) or Don't allow (false). */
    onAnswer: (allow: boolean) => void
    /** Closed without an answer (Esc, ×): nothing is stored. */
    onCancel: () => void
}

/** "Let X read files in dir?" / "Let X change files in dir?" with Allow / Don't allow. */
export function AccessQuestion({
    open,
    appName,
    dir,
    need,
    container,
    onAnswer,
    onCancel,
}: AccessQuestionProps) {
    return (
        <AccessDialog open={open} container={container} onDismiss={onCancel} showCloseButton>
            <DialogHeader className="gap-1">
                <DialogTitle className="pr-6 text-sm">
                    Let {appName} {need === "read" ? "read" : "change"} files in <FolderCode dir={dir} />?
                </DialogTitle>
                <DialogDescription className="text-xs text-colorTextSecondary">
                    {need === "read"
                        ? "The app wants to read the files in this folder."
                        : "The app wants to create, change or delete files in this folder."}
                </DialogDescription>
            </DialogHeader>

            <p className="m-0 text-xs text-colorTextTertiary">{TRUST_NOTE}</p>

            <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => onAnswer(false)}>
                    Don't allow
                </Button>
                <Button size="sm" onClick={() => onAnswer(true)}>
                    Allow
                </Button>
            </DialogFooter>
        </AccessDialog>
    )
}

export interface GrantSheetProps {
    open: boolean
    /** App name from the manifest, else the folder name. */
    appName: string
    /** App dir as presented to the user. */
    dir: string
    /** The stored level, preselected; null when never answered. */
    current: AppAccess | null
    /** Whether "Read and write files" is offered at all. */
    canWrite: boolean
    /** A positioned pane to confine the dialog to; the rest of the page stays live. */
    container?: HTMLElement | null
    onCancel: () => void
    onSave: (level: AppAccess) => void
}

/** The ⋯ "File access…" setting: Read, Read and write (where edits are allowed) or None. */
export function GrantSheet({
    open,
    appName,
    dir,
    current,
    canWrite,
    container,
    onCancel,
    onSave,
}: GrantSheetProps) {
    const initial = current === "read-write" && !canWrite ? "read" : current
    const [level, setLevel] = useState<AppAccess | null>(initial)

    return (
        <AccessDialog
            open={open}
            container={container}
            onDismiss={onCancel}
            showCloseButton={false}
        >
            <DialogHeader className="gap-1">
                <DialogTitle className="text-sm">File access for {appName}</DialogTitle>
                <DialogDescription className="text-xs text-colorTextSecondary">
                    What the app may do with the files in <FolderCode dir={dir} />
                </DialogDescription>
            </DialogHeader>

            <section aria-label="File access" data-slot="grant-sheet-access">
                <RadioGroup
                    value={level ?? ""}
                    onValueChange={(v) => setLevel(v as AppAccess)}
                    className="flex flex-col gap-2"
                >
                    <label className="flex cursor-pointer items-center gap-2">
                        <RadioGroupItem value="read" />
                        Read files
                    </label>
                    {canWrite ? (
                        <label className="flex cursor-pointer items-center gap-2">
                            <RadioGroupItem value="read-write" />
                            Read and write files
                        </label>
                    ) : null}
                    <label className="flex cursor-pointer items-center gap-2">
                        <RadioGroupItem value="none" />
                        None
                    </label>
                </RadioGroup>
            </section>

            <p className="m-0 text-xs text-colorTextTertiary">{TRUST_NOTE}</p>

            <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" disabled={level === null} onClick={() => level && onSave(level)}>
                    Save
                </Button>
            </DialogFooter>
        </AccessDialog>
    )
}
