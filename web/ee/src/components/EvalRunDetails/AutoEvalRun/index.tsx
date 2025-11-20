import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {runViewTypeAtom} from "../state/urlState"

import AutoEvalRunSkeleton from "./assets/AutoEvalRunSkeleton"
import {AutoEvalRunDetailsProps} from "./assets/types"
import EvalRunHeader from "./components/EvalRunHeader"
import EvalRunOverviewViewer from "./components/EvalRunOverviewViewer"
import EvalRunPromptConfigViewer from "./components/EvalRunPromptConfigViewer"
import EvalRunTestCaseViewer from "./components/EvalRunTestCaseViewer"

const viewTypeAtom = selectAtom(runViewTypeAtom, (v) => v, deepEqual)
const AutoEvalRunDetails = ({name, description, id, isLoading}: AutoEvalRunDetailsProps) => {
    const viewType = useAtomValue(viewTypeAtom)

    if (isLoading) {
        return <AutoEvalRunSkeleton />
    }

    return (
        <section
            className={clsx([
                "flex flex-col w-full h-[calc(100vh-84px)] gap-2 overflow-auto pb-2",
                {"!overflow-hidden": viewType === "test-cases"},
            ])}
        >
            <EvalRunHeader name={name} id={id} />

            {viewType === "overview" ? (
                <EvalRunOverviewViewer />
            ) : viewType === "test-cases" ? (
                <EvalRunTestCaseViewer />
            ) : viewType === "prompt" ? (
                <EvalRunPromptConfigViewer />
            ) : null}
        </section>
    )
}

export default AutoEvalRunDetails
