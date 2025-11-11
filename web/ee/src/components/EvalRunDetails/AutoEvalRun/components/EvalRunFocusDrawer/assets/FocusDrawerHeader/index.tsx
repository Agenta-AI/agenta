import {CaretDown, CaretUp, Copy} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {useAtom, useAtomValue} from "jotai"
import {useCallback, useMemo} from "react"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {
    evaluationScenariosDisplayAtom,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/scenarios"
import {loadable} from "jotai/utils"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import EvalRunScenarioNavigator from "@/oss/components/EvalRunDetails/components/EvalRunScenarioNavigator"

const FocusDrawerHeader = () => {
    const [focusScenarioId, setFocusScenarioId] = useAtom(focusScenarioAtom)
    const stepLoadable = useAtomValue(loadable(scenarioStepFamily(focusScenarioId!)))
    const scenarios = useAtomValue(evaluationScenariosDisplayAtom) ?? []

    const selectedScenario = useMemo(() => {
        return scenarios.find((s) => s.id === focusScenarioId)
    }, [scenarios, focusScenarioId])

    const loadPrevVariant = useCallback(() => {
        if (!focusScenarioId) return
        const prevScenarioId = scenarios[selectedScenario?.scenarioIndex - 2].id
        setFocusScenarioId(prevScenarioId)
    }, [selectedScenario, scenarios, focusScenarioId])

    const loadNextVariant = useCallback(() => {
        if (!focusScenarioId) return
        const nextScenarioId = scenarios[selectedScenario?.scenarioIndex].id
        setFocusScenarioId(nextScenarioId)
    }, [selectedScenario, scenarios, focusScenarioId])

    const isDisablePrev = useMemo(() => selectedScenario?.scenarioIndex === 1, [selectedScenario])
    const isDisableNext = useMemo(
        () => selectedScenario?.scenarioIndex === scenarios.length,
        [selectedScenario],
    )

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
                    activeId={selectedScenario?.id}
                    showStatus={false}
                    selectProps={{
                        style: {minWidth: 130},
                        className: "!py-0 !h-6",
                        size: "small",
                        placeholder: "Navigate in a test case ##",
                        onSelect: (id) => setFocusScenarioId(id),
                        popupClassName: "!p-0 min-w-[180px]",
                    }}
                    showOnlySelect
                />
                {stepLoadable.state === "hasData" &&
                    stepLoadable.data?.inputSteps?.map((input) => (
                        <TooltipWithCopyAction
                            copyText={input?.testcaseId}
                            title="Copy test case id"
                        >
                            <Tag
                                bordered={false}
                                className="bg-[#0517290F] font-normal flex items-center gap-2"
                            >
                                {input?.testcaseId} <Copy size={14} />
                            </Tag>
                        </TooltipWithCopyAction>
                    ))}
            </div>
        </div>
    )
}

export default FocusDrawerHeader
