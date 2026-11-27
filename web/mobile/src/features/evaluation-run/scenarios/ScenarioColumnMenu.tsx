import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    ArrowDown,
    ArrowsHorizontal,
    ArrowUp,
    EyeSlash,
    SortAscending,
    SortDescending,
} from "@phosphor-icons/react"
import clsx from "clsx"

import type {SortDirection} from "./scenarioTableColumns"

/** One click of Narrower or Wider, in px. */
const WIDTH_STEP = 24
const MIN_WIDTH = 32

/**
 * A column header that opens the column's menu: sort the loaded rows, set the width, reset it,
 * or hide the column. Dragging the header's edge resizes too; that handle belongs to the table.
 */
export const ScenarioColumnMenu = ({
    label,
    title,
    align = "left",
    width,
    sorted,
    onSort,
    onWidth,
    onResetWidth,
    onHide,
}: {
    label: string
    /** The column's full name, at the top of the menu. */
    title: string
    align?: "left" | "right"
    width: number
    sorted: SortDirection | null
    onSort: (direction: SortDirection) => void
    onWidth: (width: number) => void
    onResetWidth: () => void
    onHide: () => void
}) => {
    const t = useT(scenariosCatalog)
    const SortIcon = sorted === "ascending" ? ArrowUp : ArrowDown
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                title={title}
                className={clsx(
                    "flex h-7 w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-2 text-meta font-normal text-muted-foreground outline-none hover:bg-accent focus-visible:bg-accent aria-expanded:bg-accent",
                    align === "right" && "flex-row-reverse",
                )}
            >
                <span className="min-w-0 truncate">{label}</span>
                {sorted ? <SortIcon aria-hidden size={12} className="shrink-0" /> : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-58">
                <DropdownMenuLabel className="truncate text-meta font-normal text-muted-foreground">
                    {title}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onSort("ascending")}>
                    <SortAscending aria-hidden />
                    {t("evaluations.scenarios.sortAscending")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSort("descending")}>
                    <SortDescending aria-hidden />
                    {t("evaluations.scenarios.sortDescending")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="flex min-h-8 items-center gap-2 px-2 text-label">
                    <ArrowsHorizontal aria-hidden size={16} />
                    <span className="flex-1">{t("evaluations.scenarios.width")}</span>
                    <Button
                        variant="outline"
                        size="icon-xs"
                        aria-label={t("evaluations.scenarios.narrower")}
                        onClick={() => onWidth(Math.max(MIN_WIDTH, width - WIDTH_STEP))}
                    >
                        -
                    </Button>
                    <span className="min-w-11 text-center tabular-nums text-muted-foreground">
                        {t("evaluations.scenarios.pixels", {size: width})}
                    </span>
                    <Button
                        variant="outline"
                        size="icon-xs"
                        aria-label={t("evaluations.scenarios.wider")}
                        onClick={() => onWidth(width + WIDTH_STEP)}
                    >
                        +
                    </Button>
                </div>
                <DropdownMenuItem inset onSelect={onResetWidth}>
                    {t("evaluations.scenarios.resetWidth")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onHide}>
                    <EyeSlash aria-hidden />
                    {t("evaluations.scenarios.hideColumn")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
