import {memo, useMemo} from "react"

import {isEvaluationStepEnabled} from "@agenta/evaluations/core"
import {Input, Tabs, Typography} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue} from "jotai"

import useFocusInput from "@/oss/hooks/useFocusInput"

import TabLabel from "../assets/TabLabel"
import {evalStepEngineRegistry, evalStepRegistry} from "../evalSteps/registry"
import {activeEvalStepAtom, evalStepValuesAtom} from "../evalSteps/state"
import type {EvalStepDescriptor, EvalStepKind, EvalStepValueMap} from "../evalSteps/types"
import type {NewEvaluationModalContentProps} from "../types"

const tabsContainerClass =
    "h-full flex [&_.ant-tabs-content-holder]:pl-4 [&_.ant-tabs-content-holder]:flex-1 " +
    "[&_.ant-tabs-content-holder]:overflow-auto [&_.ant-tabs-tab]:text-colorTextSecondary " +
    "[&_.ant-tabs-tab]:hover:bg-colorInfoBg [&_.ant-tabs-ink-bar]:hidden " +
    "[&_.ant-tabs-tab-active]:bg-controlItemBgActive " +
    "[&_.ant-tabs-tab-active]:[border-right:2px_solid_var(--ag-colorPrimary)] " +
    "[&_.ant-tabs-tab-active]:text-colorPrimary [&_.ant-tabs-tab-active]:!font-medium"

const NewEvaluationModalContent = ({
    evaluationName,
    setEvaluationName,
    steps,
    context,
    runtime,
}: NewEvaluationModalContentProps) => {
    const {inputRef} = useFocusInput({isOpen: true})
    const [activeStep, setActiveStep] = useAtom(activeEvalStepAtom)
    const values = useAtomValue(evalStepValuesAtom)

    const items = useMemo(
        () =>
            steps
                .filter((slot) => {
                    const descriptor = evalStepRegistry[slot.kind]
                    return !slot.hidden && (descriptor.isVisible?.(context) ?? true)
                })
                .map((slot) => {
                    const descriptor = evalStepRegistry[slot.kind] as EvalStepDescriptor<
                        EvalStepKind,
                        EvalStepValueMap[EvalStepKind]
                    >
                    const value = values[slot.kind] ?? descriptor.defaultValue
                    const enabled = isEvaluationStepEnabled(
                        slot,
                        evalStepEngineRegistry,
                        context.getStepValue,
                        context,
                    )
                    const Section = descriptor.Section
                    const dependencies = (slot.dependsOn ?? [])
                        .map((kind) => evalStepRegistry[kind].title)
                        .join(", ")

                    return {
                        key: slot.kind,
                        disabled: !enabled,
                        label: (
                            <TabLabel
                                tabTitle={descriptor.title}
                                completed={descriptor.isComplete(value, context)}
                            >
                                {descriptor.renderSummary?.(value, context, slot)}
                            </TabLabel>
                        ),
                        children: enabled ? (
                            <div
                                className={clsx(
                                    "h-full",
                                    slot.locked && "pointer-events-none opacity-70",
                                )}
                                aria-disabled={slot.locked}
                            >
                                <Section
                                    value={value}
                                    slot={slot}
                                    context={context}
                                    runtime={runtime}
                                />
                            </div>
                        ) : (
                            <Typography.Text type="secondary">
                                Complete {dependencies || "the required steps"} to load this
                                section.
                            </Typography.Text>
                        ),
                    }
                }),
        [context, runtime, steps, values],
    )

    return (
        <div className="flex flex-col w-full gap-4 h-full max-h-full overflow-hidden [&_.ant-tabs]:!flex [&_.ant-tabs]:!w-full [&_.ant-tabs]:!grow [&_.ant-tabs]:!min-h-0">
            <div className="flex flex-col gap-2">
                <Typography.Text className="font-medium">Evaluation name</Typography.Text>
                <Input
                    ref={inputRef}
                    placeholder="Enter a name"
                    value={evaluationName}
                    onChange={(event) => setEvaluationName(event.target.value)}
                    data-tour="evaluation-name-input"
                />
            </div>

            <Tabs
                activeKey={activeStep ?? items[0]?.key}
                onChange={(key) => setActiveStep(key as EvalStepKind)}
                items={items}
                tabPlacement="start"
                className={clsx([
                    tabsContainerClass,
                    "[&_.ant-tabs-tab]:!p-2 [&_.ant-tabs-tab]:!mt-1",
                    "[&_.ant-tabs-nav]:!w-[240px]",
                    "[&_.ant-tabs-content]:!h-full [&_.ant-tabs-content]:!w-full",
                    "[&_.ant-tabs-tabpane]:!h-full [&_.ant-tabs-tabpane]:!max-h-full [&_.ant-tabs-tabpane]:!w-full",
                ])}
            />
        </div>
    )
}

export default memo(NewEvaluationModalContent)
