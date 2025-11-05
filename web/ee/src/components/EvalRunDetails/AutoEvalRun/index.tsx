import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import dynamic from "next/dynamic"

import {runViewTypeAtom} from "../state/urlState"

import AutoEvalRunSkeleton from "./assets/AutoEvalRunSkeleton"
import {AutoEvalRunDetailsProps} from "./assets/types"
import EvalRunHeader from "./components/EvalRunHeader"

const EvalRunOverviewViewer = dynamic(() => import("../components/EvalRunOverviewViewer"), {
    ssr: false,
})
const EvalRunPromptConfigViewer = dynamic(() => import("./components/EvalRunPromptConfigViewer"), {
    ssr: false,
})
const EvalRunTestcaseViewer = dynamic(() => import("./components/EvalRunTestcaseViewer"), {
    ssr: false,
})

const viewTypeAtom = selectAtom(runViewTypeAtom, (v) => v, deepEqual)
const AutoEvalRunDetails = ({name, description, id, isLoading}: AutoEvalRunDetailsProps) => {
    const viewType = useAtomValue(viewTypeAtom)

    if (isLoading) {
        return <AutoEvalRunSkeleton />
    }

    return (
        <section
            className={clsx([
                "flex flex-col w-full !h-[calc(100vh-84px)] gap-2 overflow-auto",
                {"!overflow-hidden": viewType === "testcases"},
            ])}
        >
            <EvalRunHeader name={name} id={id} />

            {viewType === "overview" ? (
                <EvalRunOverviewViewer type="auto" />
            ) : viewType === "testcases" ? (
                <EvalRunTestcaseViewer />
            ) : viewType === "prompt" ? (
                <EvalRunPromptConfigViewer />
            ) : null}
        </section>
    )
}

export default AutoEvalRunDetails
