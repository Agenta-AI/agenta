import {message} from "@agenta/ui/app-message"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    ArchiveIcon,
    ArrowCounterClockwise,
    Copy,
    DotsThreeVertical,
    Eye,
    GearSix,
    PencilSimple,
} from "@phosphor-icons/react"

const copyText = async (text: string, what: string) => {
    try {
        await navigator.clipboard.writeText(text)
        message.success(`${what} copied`)
    } catch {
        // `navigator.clipboard` is undefined outside a secure context.
        message.error(`Couldn't copy the ${what.toLowerCase()}`)
    }
}

/**
 * The row's kebab. The active list offers Configure (Edit for a human evaluator), Archive and the
 * two copies; the archived list offers Open details and Restore. Archive and Restore need
 * `edit_evaluators`: without it the caller passes no handler and the item is not drawn.
 */
export const EvaluatorRowMenu = ({
    copy,
    onOpen,
    openLabel,
    onArchive,
    onRestore,
    restoring = false,
}: {
    /** What the copy items put on the clipboard. */
    copy?: {revisionId: string; slug: string | null}
    onOpen?: () => void
    /** "Configure" or "Edit" in the active list, "Open details" in the archived list. */
    openLabel?: "Configure" | "Edit" | "Open details"
    onArchive?: () => void
    onRestore?: () => void
    restoring?: boolean
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <button
                type="button"
                aria-label="Evaluator actions"
                className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary after:absolute after:-inset-1.5 after:content-[''] hover:bg-colorFillTertiary hover:text-colorText"
            >
                <DotsThreeVertical size={16} weight="bold" />
            </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max min-w-[160px]">
            {onOpen ? (
                <DropdownMenuItem onSelect={onOpen}>
                    {openLabel === "Configure" ? (
                        <GearSix size={16} />
                    ) : openLabel === "Edit" ? (
                        <PencilSimple size={16} />
                    ) : (
                        <Eye size={16} />
                    )}
                    {openLabel}
                </DropdownMenuItem>
            ) : null}
            {copy ? (
                <DropdownMenuItem onSelect={() => void copyText(copy.revisionId, "ID")}>
                    <Copy size={16} />
                    Copy ID
                </DropdownMenuItem>
            ) : null}
            {copy?.slug ? (
                <DropdownMenuItem onSelect={() => void copyText(copy.slug ?? "", "Slug")}>
                    <Copy size={16} />
                    Copy Slug
                </DropdownMenuItem>
            ) : null}
            {(onRestore || onArchive) && (onOpen || copy) ? <DropdownMenuSeparator /> : null}
            {onRestore ? (
                <DropdownMenuItem disabled={restoring} onSelect={onRestore}>
                    <ArrowCounterClockwise size={16} />
                    Restore
                </DropdownMenuItem>
            ) : null}
            {onArchive ? (
                <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                    <ArchiveIcon size={16} />
                    Archive
                </DropdownMenuItem>
            ) : null}
        </DropdownMenuContent>
    </DropdownMenu>
)
