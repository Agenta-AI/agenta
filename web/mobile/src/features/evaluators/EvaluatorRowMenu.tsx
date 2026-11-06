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
    DesktopIcon,
    GearSix,
} from "@phosphor-icons/react"
import Link from "next/link"

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
 * The row's kebab. The active list offers Configure, Archive and the two copies; the archived list
 * offers Open details and Restore. Archive and Restore need `edit_evaluators`: without it the
 * caller passes no handler and the item is not drawn.
 *
 * Configure only opens the read-only drawer for now. Editing an evaluator comes with the
 * evaluator playground.
 */
export const EvaluatorRowMenu = ({
    copy,
    onOpen,
    openLabel,
    overviewHref,
    onArchive,
    onRestore,
    restoring = false,
}: {
    /** What the copy items put on the clipboard. The archived list has no copy items. */
    copy?: {revisionId: string; slug: string | null}
    /** Absent for a human evaluator in the active list: editing one comes later. */
    onOpen?: () => void
    /** "Configure" in the active list of automatic evaluators, "Open details" otherwise. */
    openLabel?: "Configure" | "Open details"
    /** The evaluator's Overview page, in beta developer mode only. */
    overviewHref?: string | null
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
                    {openLabel === "Configure" ? <GearSix size={16} /> : <Eye size={16} />}
                    {openLabel}
                </DropdownMenuItem>
            ) : null}
            {overviewHref ? (
                <DropdownMenuItem asChild>
                    <Link
                        href={overviewHref}
                        prefetch={false}
                        className="text-foreground no-underline"
                    >
                        <DesktopIcon size={16} />
                        Overview
                    </Link>
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
