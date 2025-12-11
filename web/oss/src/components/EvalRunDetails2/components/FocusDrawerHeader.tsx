import {memo, useCallback, useEffect, useMemo} from "react"

import {LeftOutlined, RightOutlined} from "@ant-design/icons"
import {Button, Select, SelectProps, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"

import {evaluationPreviewTableStore} from "../evaluationPreviewTableStore"
import {previewEvalTypeAtom} from "../state/evalType"
import {focusScenarioAtom} from "../state/focusDrawerAtom"
import {patchFocusDrawerQueryParams} from "../state/urlFocusDrawer"

interface FocusDrawerHeaderProps {
    runId: string
    scenarioId: string | null
    onScenarioChange?: (scenarioId: string) => void
}

const PAGE_SIZE = 50

const FocusDrawerHeader = ({runId, scenarioId, onScenarioChange}: FocusDrawerHeaderProps) => {
    const evalType = useAtomValue(previewEvalTypeAtom)
    const focusState = useAtomValue(focusScenarioAtom)
    const isCompareMode = focusState?.compareMode ?? false

    const {rows, paginationInfo, loadNextPage} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: runId,
        pageSize: PAGE_SIZE,
    })

    const changeScenario = useCallback(
        (nextScenarioId: string, scenarioIndex?: number, testcaseId?: string) => {
            if (onScenarioChange) {
                onScenarioChange(nextScenarioId)
            } else {
                patchFocusDrawerQueryParams({
                    focusRunId: runId,
                    focusScenarioId: nextScenarioId,
                    compareMode: isCompareMode,
                    scenarioIndex,
                    testcaseId,
                })
            }
        },
        [onScenarioChange, runId, isCompareMode],
    )

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

    const scenarioLabel = evalType === "human" ? "Scenario" : "Test case"

    const options = useMemo(() => {
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
    }, [loadedScenarios, scenarioLabel, scenarioId])

    const currentIndex = useMemo(() => {
        if (!scenarioId) return -1
        return loadedScenarios.findIndex((row) => row.scenarioId === scenarioId)
    }, [loadedScenarios, scenarioId])

    const handleSelect = useCallback<NonNullable<SelectProps["onSelect"]>>(
        (value) => {
            const nextScenarioId = typeof value === "string" ? value : String(value)
            const targetRow = loadedScenarios.find((row) => row.scenarioId === nextScenarioId)
            changeScenario(nextScenarioId, targetRow?.scenarioIndex, targetRow?.testcaseId)
        },
        [changeScenario, loadedScenarios],
    )

    const handlePrev = useCallback(() => {
        if (currentIndex <= 0) return
        const target = loadedScenarios[currentIndex - 1]
        if (!target?.scenarioId) return
        changeScenario(target.scenarioId, target.scenarioIndex, target.testcaseId)
    }, [changeScenario, currentIndex, loadedScenarios])

    const handleNext = useCallback(() => {
        if (currentIndex === -1) return
        const target = loadedScenarios[currentIndex + 1]
        if (!target?.scenarioId) return
        changeScenario(target.scenarioId, target.scenarioIndex, target.testcaseId)
    }, [changeScenario, currentIndex, loadedScenarios])

    const selectedOption = useMemo(
        () => options.find((option) => option.value === scenarioId),
        [options, scenarioId],
    )

    return (
        <div className="flex items-center justify-between gap-3 pr-4">
            <div className="flex items-center gap-2">
                <Button
                    icon={<LeftOutlined />}
                    size="small"
                    type="text"
                    onClick={handlePrev}
                    disabled={currentIndex <= 0}
                />
                <Button
                    icon={<RightOutlined />}
                    size="small"
                    type="text"
                    onClick={handleNext}
                    disabled={currentIndex === -1 || currentIndex >= loadedScenarios.length - 1}
                />
                <Select
                    showSearch
                    size="small"
                    value={scenarioId ?? undefined}
                    options={options}
                    placeholder={`Select a ${scenarioLabel.toLowerCase()}`}
                    onSelect={handleSelect}
                    filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                    style={{minWidth: 160}}
                    optionRender={(option) => (
                        <div className="flex flex-col">
                            <span>{option.data.label}</span>
                            {option.data.description ? (
                                <Typography.Text type="secondary" className="text-xs">
                                    {option.data.description}
                                </Typography.Text>
                            ) : null}
                        </div>
                    )}
                />
            </div>
            {selectedOption?.description ? (
                <Tag bordered={false} className="bg-[#0517290F] font-normal">
                    <Typography.Text copyable={{text: selectedOption.description}}>
                        {selectedOption.description}
                    </Typography.Text>
                </Tag>
            ) : null}
        </div>
    )
}

export default memo(FocusDrawerHeader)
