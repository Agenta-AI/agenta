import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    Archive,
    Copy,
    DotsThreeVertical,
    Eye,
    FileCsv,
    FileJs,
    PencilSimple,
} from "@phosphor-icons/react"

import type {TestsetRowActions} from "./testsetRowTypes"

/**
 * The kebab on a testset row. Clone, Rename and Archive show only to a reader who may edit;
 * the two exports show only to one who may export, and wait while another export runs.
 */
export const TestsetRowMenu = ({
    actions,
    canEdit,
    canExport,
    exportDisabled,
}: {
    actions: TestsetRowActions
    canEdit: boolean
    canExport: boolean
    exportDisabled: boolean
}) => {
    const {onOpen, onExport, onClone, onRename, onArchive} = actions
    const showClone = canEdit && Boolean(onClone)
    const showRename = canEdit && Boolean(onRename)
    const showSeparator = showClone || showRename || canExport

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Testset actions"
                    className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                >
                    <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
                <DropdownMenuItem onSelect={onOpen}>
                    <Eye aria-hidden size={14} />
                    View details
                </DropdownMenuItem>
                {showSeparator ? <DropdownMenuSeparator /> : null}
                {showClone ? (
                    <DropdownMenuItem onSelect={onClone}>
                        <Copy aria-hidden size={14} />
                        Clone
                    </DropdownMenuItem>
                ) : null}
                {showRename ? (
                    <DropdownMenuItem onSelect={onRename}>
                        <PencilSimple aria-hidden size={14} />
                        Rename
                    </DropdownMenuItem>
                ) : null}
                {canExport ? (
                    <>
                        <DropdownMenuItem
                            disabled={exportDisabled}
                            onSelect={() => onExport("csv")}
                        >
                            <FileCsv aria-hidden size={14} />
                            Export as CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={exportDisabled}
                            onSelect={() => onExport("json")}
                        >
                            <FileJs aria-hidden size={14} />
                            Export as JSON
                        </DropdownMenuItem>
                    </>
                ) : null}
                {canEdit ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={onArchive}>
                            <Archive aria-hidden size={14} />
                            Archive
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
