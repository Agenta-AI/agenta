import {memo, useEffect, useTransition} from "react"

import {Radio} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {runViewTypeAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {setUrlStateAtom, urlStateAtom} from "../../state/urlState"

import {ENABLE_CARD_VIEW, VIEW_OPTIONS} from "./assets/constants"

const EvalRunScenariosViewSelector = () => {
    const [viewType, setViewType] = useAtom(runViewTypeAtom)
    const [_isPending, startTransition] = useTransition()
    const urlState = useAtomValue(urlStateAtom)
    const setUrlState = useSetAtom(setUrlStateAtom)

    // Sync local atom from urlStateAtom changes
    useEffect(() => {
        if (urlState.view && urlState.view !== viewType) {
            setViewType(urlState.view as "focus" | "list" | "table")
        }
    }, [urlState.view, viewType, setViewType])

    return (
        <div className="flex items-center gap-2 shrink-0">
            <Radio.Group
                onChange={(e) => {
                    const v = e.target.value as "focus" | "list" | "table"
                    startTransition(() => {
                        setUrlState({view: v})
                    })
                }}
                defaultValue={"focus"}
                value={ENABLE_CARD_VIEW ? viewType : viewType === "list" ? "focus" : viewType}
            >
                {VIEW_OPTIONS.map((option) => (
                    <Radio.Button key={option.value} value={option.value}>
                        {option.label}
                    </Radio.Button>
                ))}
            </Radio.Group>
        </div>
    )
}

export default memo(EvalRunScenariosViewSelector)
