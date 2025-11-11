import {memo, useCallback} from "react"

import {DrawerProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {virtualScenarioTableAnnotateDrawerAtom} from "@/oss/lib/atoms/virtualTable"
import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import ScenarioAnnotationPanel from "../../ScenarioAnnotationPanel"

interface VirtualizedScenarioTableAnnotateDrawerProps extends DrawerProps {
    runId?: string
}
const VirtualizedScenarioTableAnnotateDrawer = ({
    runId,
    ...props
}: VirtualizedScenarioTableAnnotateDrawerProps) => {
    // Annotate drawer state (global, per-run)
    const annotateDrawer = useAtomValue(virtualScenarioTableAnnotateDrawerAtom)
    const setAnnotateDrawer = evalAtomStore().set

    const scenarioId = annotateDrawer.scenarioId
    const closeDrawer = useCallback(() => {
        setAnnotateDrawer(
            virtualScenarioTableAnnotateDrawerAtom,
            // @ts-ignore
            (prev) => {
                return {
                    ...prev,
                    open: false,
                }
            },
        )
    }, [])

    return (
        <EnhancedDrawer
            title="Annotate scenario"
            width={400}
            classNames={{body: "!p-0"}}
            onClose={closeDrawer}
            open={annotateDrawer.open}
            {...props}
        >
            <div
                className={clsx([
                    "flex flex-row gap-8 items-start self-stretch",
                    "[&_.ant-card]:!rounded-none [&_.scenario-annotate-panel]:!rounded-none",
                ])}
            >
                <div
                    className={clsx([
                        "scenario-annotate-panel",
                        "w-[400px] shrink-0 relative rounded-lg overflow-hidden",
                    ])}
                >
                    {scenarioId && runId && (
                        <ScenarioAnnotationPanel
                            scenarioId={scenarioId}
                            runId={runId}
                            buttonClassName="fixed top-[10px] right-2 z-50"
                            classNames={{
                                body: "!p-0 [&_.ant-btn]:mx-3 [&_.ant-btn]:mb-3 [&_.ant-btn]:mt-1",
                            }}
                            onAnnotate={closeDrawer}
                        />
                    )}
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default memo(VirtualizedScenarioTableAnnotateDrawer)
