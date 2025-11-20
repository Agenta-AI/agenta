import {memo, ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import {message} from "@agenta/oss/src/components/AppMessageContext"
import {LeftOutlined, RightOutlined} from "@ant-design/icons"
import {Button, Input, Select, SelectProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"
import {useRouter} from "next/router"

import useFocusInput from "@/oss/hooks/useFocusInput"
import {useEvalScenarioQueue} from "@/oss/lib/hooks/useEvalScenarioQueue"
import {
    evalAtomStore,
    evaluationScenariosDisplayAtom,
    scenarioStatusAtomFamily,
    scenarioStatusFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {statusColorMap} from "../../HumanEvalRun/assets/helpers"
import EvalRunScenarioStatusTag from "../EvalRunScenarioStatusTag"

const EvalRunScenarioNavigator = ({
    activeId,
    className,
    showOnlySelect = false,
    querySelectorName = "scenarioId",
    selectProps,
    showStatus = true,
}: {
    activeId: string
    className?: string
    showOnlySelect?: boolean
    querySelectorName?: string
    selectProps?: SelectProps
    showStatus?: boolean
}) => {
    const router = useRouter()
    // Get full scenario objects so we can access stable scenarioIndex
    const scenarios = useAtomValue(evaluationScenariosDisplayAtom) ?? []

    // states for select dropdown
    const [searchTerm, setSearchTerm] = useState("")
    const [isOpenSelect, setIsOpenSelect] = useState(false)
    const {inputRef} = useFocusInput({isOpen: isOpenSelect})

    // When user selects a scenario, update the URL
    const handleSelect = useCallback(
        (newId: string) => {
            if (router.query[querySelectorName] !== newId) {
                router.replace(
                    {
                        pathname: router.pathname,
                        query: {...router.query, [querySelectorName]: newId},
                    },
                    undefined,
                    {shallow: false},
                )
            }
        },
        [router, querySelectorName],
    )

    const _scenarios = useMemo(() => {
        return scenarios.filter((scenario) =>
            scenario.scenarioIndex ? scenario.scenarioIndex.toString().includes(searchTerm) : true,
        )
    }, [searchTerm, scenarios])
    const scenarioIds = _scenarios.map((s) => s.id)
    const handlePrevNext = useCallback(
        (direction: -1 | 1) => {
            if (!activeId) return
            const idx = scenarioIds.indexOf(activeId)
            const newIdx = idx + direction
            if (newIdx < 0 || newIdx >= scenarioIds.length) return
            handleSelect(scenarioIds[newIdx])
        },
        [activeId, scenarioIds, handleSelect],
    )

    const prevDisabled = scenarioIds.indexOf(activeId) <= 0
    const nextDisabled = scenarioIds.indexOf(activeId) >= scenarioIds.length - 1

    // Keyboard shortcuts: Left/Right for navigation, Meta+Enter/Ctrl+Enter for Run
    const {enqueueScenario} = useEvalScenarioQueue({concurrency: 5})
    const status = useAtomValue(
        useMemo(() => scenarioStatusAtomFamily(activeId), [activeId]),
    ) as any
    const rawStatus = status?.status
    const isRunning = ["running", "EVALUATION_STARTED"].includes(rawStatus as string)
    const isDone = [
        "done",
        "success",
        "EVALUATION_FINISHED",
        "EVALUATION_FINISHED_WITH_ERRORS",
    ].includes(rawStatus as string)

    useEffect(() => {
        if (showOnlySelect) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target && (e.target as HTMLElement).tagName === "INPUT") return // don't hijack input fields
            if (e.key === "ArrowLeft" && !prevDisabled) {
                handlePrevNext(-1)
                e.preventDefault()
            } else if (e.key === "ArrowRight" && !nextDisabled) {
                handlePrevNext(1)
                e.preventDefault()
            } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                // Access invocationParameters inline from atom store
                const stepLoadable = evalAtomStore().get(loadable(scenarioStepFamily(activeId)))
                const hasInvocationParams =
                    stepLoadable.state === "hasData" &&
                    stepLoadable.data?.invocationSteps?.some((st: any) => st.invocationParameters)
                if (!isRunning && !isDone && hasInvocationParams && activeId) {
                    enqueueScenario(activeId)
                } else if (!hasInvocationParams) {
                    message.success("This scenario has already been ran before")
                }
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [
        handlePrevNext,
        prevDisabled,
        nextDisabled,
        activeId,
        isRunning,
        isDone,
        enqueueScenario,
        showOnlySelect,
    ])

    return (
        <section className={clsx("w-full flex items-center justify-between gap-2", className)}>
            {!showOnlySelect && (
                <Button
                    icon={<LeftOutlined />}
                    onClick={() => handlePrevNext(-1)}
                    disabled={prevDisabled}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowLeft") {
                            handlePrevNext(-1)
                        }
                    }}
                >
                    Prev
                </Button>
            )}
            <div className="relative">
                <Select
                    open={isOpenSelect}
                    onOpenChange={(open) => {
                        setIsOpenSelect(open)
                        setSearchTerm("")
                    }}
                    value={activeId}
                    style={{minWidth: 250}}
                    onChange={(value) => handleSelect(value as string)}
                    optionLabelProp="label"
                    classNames={{
                        popup: {
                            root: "!p-0",
                        },
                    }}
                    popupRender={(menu: ReactNode) => (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between border-0 border-b border-solid border-[#f0f0f0] pr-1">
                                <Input
                                    ref={inputRef}
                                    placeholder="Number"
                                    variant="borderless"
                                    className="rounded-none py-2"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                <Button
                                    disabled={!searchTerm}
                                    onClick={() => {
                                        handleSelect(
                                            _scenarios.find(
                                                (s) => s.scenarioIndex === Number(searchTerm),
                                            )?.id as string,
                                        )
                                        setIsOpenSelect(false)
                                    }}
                                >
                                    Go
                                </Button>
                            </div>

                            <div className="px-1 pb-1">{menu}</div>
                        </div>
                    )}
                    {...selectProps}
                >
                    {_scenarios.map((scenario) => {
                        const {id, scenarioIndex} = scenario as any

                        // non-hook read; never suspends
                        const loadableStatus = evalAtomStore().get(
                            loadable(scenarioStatusFamily(id)),
                        )
                        const scenStatus =
                            loadableStatus.state === "hasData"
                                ? loadableStatus.data
                                : {status: "pending", label: "Pending"}

                        const colorClass = statusColorMap[scenStatus.status]
                        const labelIndex = scenarioIndex ?? scenarioIds.indexOf(id) + 1

                        return (
                            <Select.Option key={id} value={id} label={`Test case: ${labelIndex}`}>
                                <div className="flex items-center justify-between w-full">
                                    <span>Scenario {labelIndex}</span>
                                    <span className={clsx(colorClass)}>{scenStatus.status}</span>
                                </div>
                            </Select.Option>
                        )
                    })}
                </Select>

                {activeId && showStatus ? (
                    <EvalRunScenarioStatusTag
                        scenarioId={activeId}
                        className="absolute right-8 top-1"
                        showAsTag={false}
                    />
                ) : null}
            </div>

            {!showOnlySelect && (
                <Button
                    icon={<RightOutlined />}
                    iconPosition="end"
                    onClick={() => handlePrevNext(1)}
                    disabled={nextDisabled}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowRight") {
                            handlePrevNext(1)
                        }
                    }}
                >
                    Next
                </Button>
            )}
        </section>
    )
}

export default memo(EvalRunScenarioNavigator)
