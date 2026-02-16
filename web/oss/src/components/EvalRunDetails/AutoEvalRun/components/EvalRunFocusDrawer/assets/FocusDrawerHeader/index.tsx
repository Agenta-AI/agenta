import {useCallback, useMemo, useState} from "react"

import {CaretDown, CaretUp, Check, Copy} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {atom, useAtomValue} from "jotai"

import EvalRunScenarioNavigator from "@/oss/components/EvalRunDetails/components/EvalRunScenarioNavigator"
import {useCachedScenarioSteps} from "@/oss/components/EvalRunDetails/hooks/useCachedScenarioSteps"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {scenariosFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useAppNavigation} from "@/oss/state/appState"

import FocusDrawerHeaderSkeleton from "../Skeletons/FocusDrawerHeaderSkeleton"

const FocusDrawerHeader = () => {
    const [isCopy, setIsCopy] = useState(false)
    const focus = useAtomValue(focusScenarioAtom)
    const evalType = useAtomValue(evalTypeAtom)
    const navigation = useAppNavigation()

    const runId = focus?.focusRunId as string
    const focusScenarioId = focus?.focusScenarioId as string
    const isOnlineEval = evalType === "online"
    const scenarioLabel = isOnlineEval ? "scenario" : "testcase"

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

    const {
        data: scenarioSteps,
        state: stepState,
        hasResolved,
    } = useCachedScenarioSteps(runId, focusScenarioId)

    const emptyScenarioListAtom = useMemo(() => atom<any[]>([]), [])
    const scenariosAtom = useMemo(() => {
        if (!runId) return emptyScenarioListAtom
        return scenariosFamily(runId)
    }, [runId, emptyScenarioListAtom])
    const scenarios = useAtomValue(scenariosAtom) ?? []

    const selectedScenario = useMemo(
        () => scenarios.find((s) => s.id === focusScenarioId),
        [scenarios, focusScenarioId],
    )

    const selectedScenarioIndex = useMemo(() => {
        if (!selectedScenario) return null
        if (typeof selectedScenario.scenarioIndex === "number") {
            return selectedScenario.scenarioIndex
        }
        const derivedIndex = scenarios.findIndex((s) => s.id === selectedScenario.id)
        return derivedIndex === -1 ? null : derivedIndex + 1
    }, [selectedScenario, scenarios])

    const loadPrevVariant = useCallback(() => {
        if (!selectedScenario) return
        const currentIndex = (selectedScenarioIndex || 1) - 1
        const prevIndex = currentIndex - 1
        if (prevIndex < 0) return
        const prevScenario = scenarios[prevIndex]
        if (!prevScenario) return
        handleScenarioChange(prevScenario.id)
    }, [handleScenarioChange, selectedScenario, selectedScenarioIndex, scenarios])

    const loadNextVariant = useCallback(() => {
        if (!selectedScenario) return
        const currentIndex = (selectedScenarioIndex || 1) - 1
        const nextIndex = currentIndex + 1
        const nextScenario = scenarios[nextIndex]
        if (!nextScenario) return
        handleScenarioChange(nextScenario.id)
    }, [handleScenarioChange, selectedScenario, selectedScenarioIndex, scenarios])

    const isDisablePrev = useMemo(
        () => !selectedScenario || selectedScenarioIndex === 1,
        [selectedScenario, selectedScenarioIndex],
    )
    const isDisableNext = useMemo(
        () => !selectedScenario || selectedScenarioIndex === scenarios.length,
        [selectedScenario, selectedScenarioIndex, scenarios],
    )

    if (!hasResolved && stepState === "loading") {
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
                {runId ? (
                    <EvalRunScenarioNavigator
                        querySelectorName="focusScenarioId"
                        runId={runId}
                        activeId={selectedScenario?.id}
                        showStatus={false}
                        selectProps={{
                            style: {minWidth: 130},
                            className: "!py-0 !h-6",
                            size: "small",
                            placeholder: `Navigate in a ${scenarioLabel} ##`,
                            onSelect: (id) => handleScenarioChange(id),
                            classNames: {popup: {root: "!p-0 !min-w-[180px]"}},
                        }}
                        showOnlySelect
                    />
                ) : null}
                {scenarioSteps?.inputSteps?.map((input) => {
                    const rawIdentifier =
                        input?.testcaseId ?? (input as any)?.scenarioId ?? undefined
                    const identifier =
                        rawIdentifier === undefined || rawIdentifier === null
                            ? undefined
                            : String(rawIdentifier)
                    if (!identifier) return null

                    return (
                        <TooltipWithCopyAction
                            key={identifier}
                            copyText={identifier}
                            title={`Copy ${scenarioLabel} id`}
                        >
                            <Tag
                                bordered={false}
                                className="bg-[#0517290F] font-mono flex items-center gap-2"
                                onClick={() => {
                                    setIsCopy(true)
                                    setTimeout(() => {
                                        setIsCopy(false)
                                    }, 1500)
                                }}
                            >
                                {identifier} {isCopy ? <Check size={14} /> : <Copy size={14} />}
                            </Tag>
                        </TooltipWithCopyAction>
                    )
                })}
            </div>
        </div>
    )
}

export default FocusDrawerHeader
