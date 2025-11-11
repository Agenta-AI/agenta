import {useCallback, useMemo, useState} from "react"

import {CaretDown, CaretUp, Check, Copy} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import EvalRunScenarioNavigator from "@/oss/components/EvalRunDetails/components/EvalRunScenarioNavigator"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {
    scenariosFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useAppNavigation} from "@/oss/state/appState"

import FocusDrawerHeaderSkeleton from "../Skeletons/FocusDrawerHeaderSkeleton"

const FocusDrawerHeader = () => {
    const [isCopy, setIsCopy] = useState(false)
    const focus = useAtomValue(focusScenarioAtom)
    const navigation = useAppNavigation()

    const runId = focus?.focusRunId as string
    const focusScenarioId = focus?.focusScenarioId as string

    const handleScenarioChange = useCallback(
        (nextScenarioId: string) => {
            navigation.patchQuery(
                {
                    focusScenarioId: nextScenarioId,
                    focusRunId: runId,
                },
                {shallow: true},
            )
        },
        [navigation, runId],
    )

    const stepLoadable = useAtomValue(
        loadable(
            scenarioStepFamily({
                runId,
                scenarioId: focusScenarioId,
            }),
        ),
    )
    const scenarios = useAtomValue(scenariosFamily(runId)) ?? []

    const selectedScenario = useMemo(() => {
        return scenarios.find((s) => s.id === focusScenarioId)
    }, [scenarios, focusScenarioId])

    const loadPrevVariant = useCallback(() => {
        if (!selectedScenario) return
        const prevIndex = selectedScenario.scenarioIndex - 2
        if (prevIndex < 0) return
        const prevScenario = scenarios[prevIndex]
        if (!prevScenario) return
        handleScenarioChange(prevScenario.id)
    }, [handleScenarioChange, selectedScenario, scenarios])

    const loadNextVariant = useCallback(() => {
        if (!selectedScenario) return
        const nextIndex = selectedScenario.scenarioIndex || 1
        const nextScenario = scenarios[nextIndex]
        if (!nextScenario) return
        handleScenarioChange(nextScenario.id)
    }, [handleScenarioChange, selectedScenario, scenarios])

    const isDisablePrev = useMemo(() => selectedScenario?.scenarioIndex === 1, [selectedScenario])
    const isDisableNext = useMemo(
        () => selectedScenario?.scenarioIndex === scenarios.length,
        [selectedScenario, scenarios],
    )

    if (stepLoadable.state === "loading") {
        return <FocusDrawerHeaderSkeleton />
    }

    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                    <Button
                        icon={<CaretUp size={16} />}
                        size="small"
                        type="text"
                        onClick={loadPrevVariant}
                        disabled={isDisablePrev}
                    />
                    <Button
                        icon={<CaretDown size={16} />}
                        size="small"
                        type="text"
                        onClick={loadNextVariant}
                        disabled={isDisableNext}
                    />
                </div>
                <EvalRunScenarioNavigator
                    querySelectorName="focus"
                    runId={runId}
                    activeId={selectedScenario?.id}
                    showStatus={false}
                    selectProps={{
                        style: {minWidth: 130},
                        className: "!py-0 !h-6",
                        size: "small",
                        placeholder: "Navigate in a test case ##",
                        onSelect: (id) => handleScenarioChange(id),
                        classNames: {popup: {root: "!p-0 !min-w-[180px]"}},
                    }}
                    showOnlySelect
                />
                {stepLoadable.state === "hasData" &&
                    stepLoadable.data?.inputSteps?.map((input, index) => (
                        <TooltipWithCopyAction
                            key={input?.testcaseId ?? `focus-input-${index}`}
                            copyText={input?.testcaseId}
                            title="Copy test case id"
                        >
                            <Tag
                                bordered={false}
                                className="bg-[#0517290F] font-normal flex items-center gap-2"
                                onClick={() => {
                                    setIsCopy(true)
                                    setTimeout(() => {
                                        setIsCopy(false)
                                    }, 1500)
                                }}
                            >
                                {input?.testcaseId}{" "}
                                {isCopy ? <Check size={14} /> : <Copy size={14} />}
                            </Tag>
                        </TooltipWithCopyAction>
                    ))}
            </div>
        </div>
    )
}

export default FocusDrawerHeader
