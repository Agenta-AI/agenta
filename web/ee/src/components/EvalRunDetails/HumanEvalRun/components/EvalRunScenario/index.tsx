import {memo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import {runViewTypeAtom} from "../../../state/urlState"
import EvalRunScenarioCard from "../EvalRunScenarioCard"
import ScenarioAnnotationPanel from "../ScenarioAnnotationPanel"

import {EvalRunScenarioProps} from "./types"

const EvalRunScenario = ({scenarioId, runId, className}: EvalRunScenarioProps) => {
    const viewType = useAtomValue(runViewTypeAtom)

    return (
        <div
            className={clsx([
                className,
                {
                    "flex flex-row gap-8 items-start self-stretch": viewType === "focus",
                    "flex flex-col gap-2 self-stretch [&_>_.ant-card]:grow": viewType !== "focus",
                },
            ])}
        >
            <div
                className={clsx([
                    "scenario-annotate-panel",
                    {
                        "w-[400px] shrink-0 relative rounded-lg overflow-hidden":
                            viewType === "focus",
                    },
                ])}
            >
                {viewType !== "focus" ? (
                    <EvalRunScenarioCard scenarioId={scenarioId} runId={runId} />
                ) : null}
                <ScenarioAnnotationPanel
                    runId={runId}
                    scenarioId={scenarioId}
                    classNames={
                        viewType === "focus"
                            ? {
                                  body: "!p-0 [&_.ant-btn]:mx-3 [&_.ant-btn]:mb-3 [&_.ant-btn]:mt-1",
                              }
                            : undefined
                    }
                />
            </div>
        </div>
    )
}

export default memo(EvalRunScenario)
