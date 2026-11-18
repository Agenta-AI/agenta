import {Button} from "@agenta/ui/ui"
import {Archive, ArrowUUpLeft, X} from "@phosphor-icons/react"

/** Replaces the toolbar while skills are selected. */
export const SkillSelectionBar = ({
    count,
    total,
    archived,
    onClear,
    onSelectAll,
    onArchive,
    onRestore,
}: {
    count: number
    total: number
    /** The archived view: the bulk action is Restore. */
    archived: boolean
    onClear: () => void
    onSelectAll: () => void
    onArchive: () => void
    onRestore: () => void
}) => (
    <div
        role="toolbar"
        aria-label="Selected skills"
        className="mb-3 box-border flex h-9 animate-in fade-in-0 motion-reduce:animate-none shrink-0 items-center gap-2 rounded-[10px] border border-solid border-input bg-background px-[3px]"
    >
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear selection"
            title="Clear selection"
            onClick={onClear}
            className="size-7 text-muted-foreground"
        >
            <X size={15} />
        </Button>
        <span aria-live="polite" className="whitespace-nowrap text-sm font-medium tabular-nums">
            {count} selected
        </span>
        {count < total ? (
            <>
                <span aria-hidden className="text-muted-foreground">
                    ·
                </span>
                <button
                    type="button"
                    onClick={onSelectAll}
                    className="cursor-pointer whitespace-nowrap rounded border-0 bg-transparent px-0.5 font-[inherit] text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                    Select all {total}
                </button>
            </>
        ) : null}
        <span className="flex-1" />
        {archived ? (
            <Button variant="ghost" size="sm" className="h-7 font-medium" onClick={onRestore}>
                <ArrowUUpLeft size={14} />
                Restore
            </Button>
        ) : (
            <Button variant="ghost" size="sm" className="h-7 font-medium" onClick={onArchive}>
                <Archive size={14} />
                Archive
            </Button>
        )}
    </div>
)
