import type {ComponentProps} from "react"

import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {SlidersHorizontal} from "@phosphor-icons/react"

import {ScenarioColumnsPanel} from "./ScenarioColumnsPanel"
import type {ScenarioFieldColumn} from "./scenarioTableColumns"
import {
    ROW_HEIGHT,
    type ScenarioDensity,
    type ScenarioRowHeight,
    type ScenarioView,
} from "./scenarioViewDefaults"

const NONE = "__none__"

const SubValue = ({children}: {children: string}) => (
    <span className="ml-auto truncate pl-2 font-normal text-muted-foreground">{children}</span>
)

const Hint = ({children}: {children: string}) => (
    <span className="ml-auto pl-2 font-normal whitespace-nowrap text-muted-foreground">
        {children}
    </span>
)

/**
 * The Display menu of the Scenarios table: density, the label column, the columns, the row
 * height, and a reset of the column widths. Every change applies at once and is kept for the run.
 */
export const ScenariosDisplayMenu = ({
    view,
    labelOptions,
    labelKey,
    hiddenCount,
    columns,
    fieldLabel,
    onDensity,
    onLabel,
    onRowHeight,
    onResetWidths,
}: {
    view: ScenarioView
    /** The test case columns that can be the label column. */
    labelOptions: ScenarioFieldColumn[]
    labelKey: string | null
    hiddenCount: number
    columns: Omit<ComponentProps<typeof ScenarioColumnsPanel>, "labelName" | "fieldLabel">
    fieldLabel: (column: ScenarioFieldColumn) => string
    onDensity: (density: ScenarioDensity) => void
    onLabel: (key: string | null) => void
    onRowHeight: (height: ScenarioRowHeight) => void
    onResetWidths: () => void
}) => {
    const t = useT(scenariosCatalog)
    const label = labelOptions.find((column) => column.key === labelKey)
    const labelName = label ? fieldLabel(label) : null
    const densityName = (density: ScenarioDensity) =>
        density === "compact"
            ? t("evaluations.scenarios.densityCompact")
            : t("evaluations.scenarios.densityComfortable")
    const heightName = (height: ScenarioRowHeight) =>
        height === "short"
            ? t("evaluations.scenarios.rowHeightShort")
            : t("evaluations.scenarios.rowHeightTall")
    const shapeHint = (column: ScenarioFieldColumn) =>
        column.shape === "text-short"
            ? t("evaluations.scenarios.shortText")
            : column.shape === "text-long" || column.shape === "markdown"
              ? t("evaluations.scenarios.longText")
              : ""

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                    <SlidersHorizontal aria-hidden />
                    {t("evaluations.scenarios.display")}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-62">
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {t("evaluations.scenarios.density")}
                        <SubValue>{densityName(view.density)}</SubValue>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-70">
                        <DropdownMenuRadioGroup
                            value={view.density}
                            onValueChange={(value) => onDensity(value as ScenarioDensity)}
                        >
                            <DropdownMenuRadioItem value="comfortable">
                                <span className="flex w-full">
                                    {densityName("comfortable")}
                                    <Hint>{t("evaluations.scenarios.densityComfortableHint")}</Hint>
                                </span>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="compact">
                                <span className="flex w-full">
                                    {densityName("compact")}
                                    <Hint>{t("evaluations.scenarios.densityCompactHint")}</Hint>
                                </span>
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {t("evaluations.scenarios.labelColumn")}
                        <SubValue>{labelName ?? t("evaluations.scenarios.labelNone")}</SubValue>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-70">
                        <DropdownMenuRadioGroup
                            value={labelKey ?? NONE}
                            onValueChange={(value) => onLabel(value === NONE ? null : value)}
                        >
                            <DropdownMenuRadioItem value={NONE}>
                                {t("evaluations.scenarios.labelNone")}
                            </DropdownMenuRadioItem>
                            {labelOptions.map((column) => (
                                <DropdownMenuRadioItem key={column.key} value={column.key}>
                                    <span className="flex w-full min-w-0">
                                        <span className="truncate">{fieldLabel(column)}</span>
                                        <Hint>{shapeHint(column)}</Hint>
                                    </span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {t("evaluations.scenarios.columns")}
                        <SubValue>
                            {t("evaluations.scenarios.hiddenCount", {count: hiddenCount})}
                        </SubValue>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-150 w-95 p-0">
                        <ScenarioColumnsPanel
                            {...columns}
                            labelName={labelName}
                            fieldLabel={fieldLabel}
                        />
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {t("evaluations.scenarios.rowHeight")}
                        <SubValue>{heightName(view.rowHeight)}</SubValue>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                        <DropdownMenuRadioGroup
                            value={view.rowHeight}
                            onValueChange={(value) => onRowHeight(value as ScenarioRowHeight)}
                        >
                            {(["short", "tall"] as const).map((height) => (
                                <DropdownMenuRadioItem key={height} value={height}>
                                    <span className="flex w-full">
                                        {heightName(height)}
                                        <Hint>
                                            {t("evaluations.scenarios.pixels", {
                                                size: ROW_HEIGHT[height],
                                            })}
                                        </Hint>
                                    </span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onSelect={onResetWidths}>
                    {t("evaluations.scenarios.resetWidths")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
