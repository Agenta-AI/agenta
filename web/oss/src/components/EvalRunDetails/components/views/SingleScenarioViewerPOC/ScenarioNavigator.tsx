import {memo, useCallback, useEffect, useMemo} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxValue,
} from "@agenta/primitive-ui/components/combobox"
import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {LeftOutlined, RightOutlined} from "@ant-design/icons"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"

import {evaluationPreviewTableStore} from "../../../evaluationPreviewTableStore"

interface ScenarioNavigatorProps {
    runId: string
    scenarioId: string | null
    onChange: (scenarioId: string) => void
    showScenarioIdTag?: boolean
}

const PAGE_SIZE = 50

const ScenarioNavigator = ({
    runId,
    scenarioId,
    onChange,
    showScenarioIdTag = true,
}: ScenarioNavigatorProps) => {
    const {rows, paginationInfo, loadNextPage} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: runId,
        pageSize: PAGE_SIZE,
    })

    const loadedScenarios = useMemo(
        () =>
            rows
                .filter((row) => !row.__isSkeleton && row.scenarioId)
                .sort(
                    (a, b) =>
                        (a.scenarioIndex ?? Number.MAX_SAFE_INTEGER) -
                        (b.scenarioIndex ?? Number.MAX_SAFE_INTEGER),
                ),
        [rows],
    )

    const options = useMemo(() => {
        const scenarioLabel = "Scenario"
        const base = loadedScenarios.map((row) => ({
            value: row.scenarioId as string,
            label: `${scenarioLabel} #${row.scenarioIndex ?? "?"}`,
            description: row.scenarioId,
        }))

        if (scenarioId && !base.some((option) => option.value === scenarioId)) {
            base.push({
                value: scenarioId,
                label: `${scenarioLabel} ${scenarioId.slice(0, 8)}…`,
                description: scenarioId,
            })
        }

        return base
    }, [loadedScenarios, scenarioId])

    const currentIndex = useMemo(() => {
        if (!scenarioId) return -1
        return loadedScenarios.findIndex((row) => row.scenarioId === scenarioId)
    }, [loadedScenarios, scenarioId])

    const handleValueChange = useCallback(
        (nextScenarioId: string) => {
            onChange(nextScenarioId)
        },
        [onChange],
    )

    const handlePrev = useCallback(() => {
        if (currentIndex <= 0) return
        const target = loadedScenarios[currentIndex - 1]
        if (!target?.scenarioId) return
        onChange(target.scenarioId)
    }, [currentIndex, loadedScenarios, onChange])

    const handleNext = useCallback(() => {
        if (currentIndex === -1) return
        const target = loadedScenarios[currentIndex + 1]
        if (!target?.scenarioId) return
        onChange(target.scenarioId)
    }, [currentIndex, loadedScenarios, onChange])

    useEffect(() => {
        if (!scenarioId) return
        const hasScenarioLoaded = loadedScenarios.some((row) => row.scenarioId === scenarioId)
        if (!hasScenarioLoaded && paginationInfo.hasMore && !paginationInfo.isFetching) {
            loadNextPage()
        }
    }, [
        scenarioId,
        loadedScenarios,
        paginationInfo.hasMore,
        paginationInfo.isFetching,
        loadNextPage,
    ])

    const selectedOption = useMemo(
        () => options.find((option) => option.value === scenarioId),
        [options, scenarioId],
    )

    return (
        <div
            className={`flex items-center gap-3 ${
                showScenarioIdTag ? "justify-between pr-4" : "flex-wrap"
            }`}
        >
            <div className="flex items-center gap-2">
                <Button
                    onClick={handlePrev}
                    disabled={currentIndex <= 0}
                    variant="ghost"
                    size="icon-sm"
                >
                    {<LeftOutlined />}
                </Button>
                <Button
                    onClick={handleNext}
                    disabled={currentIndex === -1 || currentIndex >= loadedScenarios.length - 1}
                    variant="ghost"
                    size="icon-sm"
                >
                    {<RightOutlined />}
                </Button>
                <Combobox value={scenarioId ?? ""} onValueChange={handleValueChange}>
                    <ComboboxTrigger className="min-w-48" size="sm">
                        <ComboboxValue placeholder="Select a scenario" />
                    </ComboboxTrigger>
                    <ComboboxContent>
                        <ComboboxInput placeholder="Search..." />
                        <ComboboxEmpty>No results</ComboboxEmpty>
                        {options.map((o) => (
                            <ComboboxItem key={o.value} value={o.value}>
                                <div className="flex flex-col">
                                    <span>{o.label}</span>
                                    {o.description ? (
                                        <span className="text-xs text-muted-foreground">
                                            {o.description}
                                        </span>
                                    ) : null}
                                </div>
                            </ComboboxItem>
                        ))}
                    </ComboboxContent>
                </Combobox>
            </div>
            {showScenarioIdTag && selectedOption?.description ? (
                <Badge className="bg-[var(--ag-c-0517290F)] font-normal" variant="secondary">
                    <CopyTooltip copyText={selectedOption.description} title="Copy scenario id">
                        <span className="cursor-copy">{selectedOption.description}</span>
                    </CopyTooltip>
                </Badge>
            ) : null}
        </div>
    )
}

export default memo(ScenarioNavigator)
