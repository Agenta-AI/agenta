import {memo, useTransition} from "react"

import {Radio} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {evalTypeAtom} from "../../state/evalType"
import {runViewTypeAtom} from "../../state/urlState"

import {
    ENABLE_CARD_VIEW,
    VIEW_HUMAN_OPTIONS,
    VIEW_AUTO_OPTIONS,
    VIEW_ONLINE_OPTIONS,
} from "./assets/constants"

const EvalRunScenariosViewSelector = () => {
    const evalType = useAtomValue(evalTypeAtom)
    // Read from the same global store that writes are going to
    const viewType = useAtomValue(runViewTypeAtom)
    const [_isPending, startTransition] = useTransition()

    const router = useRouter()

    // Sync local atom from urlStateAtom changes
    const resolveTourId = (value: string) => {
        if (evalType !== "online") return undefined
        if (value === "overview") return "tour-online-eval-tab-overview"
        if (value === "results") return "tour-online-eval-tab-results"
        if (value === "configuration") return "tour-online-eval-tab-configuration"
        return undefined
    }

    return (
        <div className="flex items-center gap-2 shrink-0">
            <Radio.Group
                onChange={(e) => {
                    const v = e.target.value as
                        | "focus"
                        | "list"
                        | "table"
                        | "overview"
                        | "testcases"
                        | "prompt"
                        | "results"
                        | "configuration"
                    startTransition(() => {
                        // Update router query so UrlSync can mirror it into atoms
                        const nextQuery: Record<string, any> = {...router.query, view: v}
                        if (v !== "focus") {
                            delete nextQuery.scenarioId
                        }
                        router.replace({pathname: router.pathname, query: nextQuery}, undefined, {
                            shallow: true,
                        })
                    })
                }}
                defaultValue={evalType === "online" ? "results" : "focus"}
                value={ENABLE_CARD_VIEW ? viewType : viewType === "list" ? "focus" : viewType}
            >
                <div
                    id={
                        viewType === "focus"
                            ? "tour-human-eval-focus-tab"
                            : viewType === "table"
                              ? "tour-human-eval-table-view"
                              : viewType === "results"
                                ? "tour-human-eval-results-tab"
                                : ""
                    }
                >
                    {(evalType === "human"
                        ? VIEW_HUMAN_OPTIONS
                        : evalType === "online"
                          ? VIEW_ONLINE_OPTIONS
                          : VIEW_AUTO_OPTIONS
                    ).map((option) => (
                        <Radio.Button
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                            id={resolveTourId(option.value)}
                        >
                            {option.label}
                        </Radio.Button>
                    ))}
                </div>
            </Radio.Group>
        </div>
    )
}

export default memo(EvalRunScenariosViewSelector)
