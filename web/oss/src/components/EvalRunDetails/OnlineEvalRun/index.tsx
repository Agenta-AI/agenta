import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import NextViewport from "@/oss/components/Onboarding/components/NextViewport"
import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import EvalRunHeader from "../AutoEvalRun/components/EvalRunHeader"
import EvalRunOverviewViewer from "../components/EvalRunOverviewViewer"
import VirtualizedScenarioTable from "../components/VirtualizedScenarioTable"
import {runViewTypeAtom} from "../state/urlState"

import ConfigurationViewer from "./components/ConfigurationViewer"

export interface OnlineEvalRunDetailsProps {
    name: string
    description: string
    id: string
    isLoading?: boolean
}

const viewTypeAtom = selectAtom(runViewTypeAtom, (v) => v, deepEqual)
const OnlineEvalRunDetails = ({name, id, isLoading}: OnlineEvalRunDetailsProps) => {
    const store = evalAtomStore()
    const viewType = useAtomValue(viewTypeAtom, {store})

    const viewportId =
        viewType === "overview"
            ? "online-eval-overview-viewport"
            : viewType === "configuration"
              ? "online-eval-configuration-viewport"
              : "online-eval-results-viewport"

    // No special skeleton for now; render minimal shell if loading
    if (isLoading) {
        return (
            <section className="flex flex-col w-full h-[calc(100vh-84px)] gap-2 overflow-auto">
                <EvalRunHeader name={name} id={id} />
            </section>
        )
    }

    return (
        <section
            className={clsx([
                "flex flex-col w-full h-[calc(100vh-84px)] gap-2 overflow-auto overflow-x-hidden max-w-full",
                {"!overflow-hidden": viewType === "results"},
            ])}
        >
            <NextViewport id={viewportId}>
                <EvalRunHeader name={name} id={id} />

                {viewType === "overview" ? (
                    <EvalRunOverviewViewer type="online" />
                ) : viewType === "results" ? (
                    <VirtualizedScenarioTable />
                ) : viewType === "configuration" ? (
                    <ConfigurationViewer />
                ) : null}
            </NextViewport>
        </section>
    )
}

export default OnlineEvalRunDetails
