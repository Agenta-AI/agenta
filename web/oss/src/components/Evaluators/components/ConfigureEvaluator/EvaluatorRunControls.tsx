/**
 * EvaluatorRunControls
 *
 * The run-on + app + testset control cluster, shared by the evaluator
 * playground page header and the evaluator-creation drawer header so the two
 * stay identical. Reads everything from `useEvaluatorRunControls` (atom-backed),
 * so it takes no props — drop it next to a title and it works on either surface.
 *
 * - Run-on selector (test case / app output / trace).
 * - App picker — only in "app" mode, with a disconnect affordance once connected.
 * - Test set dropdown — always available: it's the data source in test-case
 *   mode and feeds the app in app mode.
 */

import {EntityPicker} from "@agenta/entity-ui"
import type {WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {Button} from "@agenta/primitive-ui/components/button"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {X} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import RunOnSelector from "./RunOnSelector"
import {useEvaluatorRunControls} from "./useEvaluatorRunControls"

const TestsetDropdown = dynamic(
    () => import("@/oss/components/Playground/Components/TestsetDropdown"),
    {ssr: false},
)

const EvaluatorRunControls = () => {
    const {
        appWorkflowAdapter,
        handleAppSelect,
        disconnectApp,
        runOnMode,
        handlePickRunOn,
        hasAppConnected,
        selectedAppLabel,
    } = useEvaluatorRunControls()

    const isAppMode = runOnMode === "app"

    // Footer inside the picker popover — only when an app is currently connected.
    const popupFooter = hasAppConnected ? (
        <div className="border-0 border-t border-solid border-[var(--ag-rgba-051729-06)] p-2">
            <Button
                className="w-full"
                onClick={() => disconnectApp()}
                variant="destructive"
                size="sm"
            >
                Disconnect app
            </Button>
        </div>
    ) : undefined

    return (
        <div className="flex min-w-0 items-center justify-end gap-1">
            <RunOnSelector mode={runOnMode} onPick={handlePickRunOn} />

            {isAppMode && (
                <EntityPicker<WorkflowRevisionSelectionResult>
                    variant="popover-cascader"
                    adapter={appWorkflowAdapter}
                    onSelect={handleAppSelect}
                    size="small"
                    placeholder={selectedAppLabel ?? "Select app"}
                    popupFooter={popupFooter}
                />
            )}

            {isAppMode && hasAppConnected && (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                onClick={() => disconnectApp()}
                                aria-label="Disconnect app"
                                variant="ghost"
                                size="icon-sm"
                            >
                                {<X size={12} />}
                            </Button>
                        }
                    />
                    <TooltipContent>{"Disconnect app"}</TooltipContent>
                </Tooltip>
            )}

            <TestsetDropdown />
        </div>
    )
}

export default EvaluatorRunControls
