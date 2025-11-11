import {memo, useTransition} from "react"

import {Radio} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {evalTypeAtom} from "../../state/evalType"
import {runViewTypeAtom, urlStateAtom} from "../../state/urlState"

import {ENABLE_CARD_VIEW, VIEW_HUMAN_OPTIONS, VIEW_AUTO_OPTIONS} from "./assets/constants"

const EvalRunScenariosViewSelector = () => {
    const evalType = useAtomValue(evalTypeAtom)
    // Read from the same global store that writes are going to
    const viewType = useAtomValue(runViewTypeAtom)
    const [_isPending, startTransition] = useTransition()

    const setUrlState = useSetAtom(urlStateAtom)

    // Sync local atom from urlStateAtom changes
    return (
        <div className="flex items-center gap-2 shrink-0">
            <Radio.Group
                onChange={(e) => {
                    const v = e.target.value as "focus" | "list" | "table"
                    startTransition(() => {
                        setUrlState((draft) => {
                            draft.view = v
                        })
                    })
                }}
                defaultValue={"focus"}
                value={ENABLE_CARD_VIEW ? viewType : viewType === "list" ? "focus" : viewType}
            >
                {(evalType === "human" ? VIEW_HUMAN_OPTIONS : VIEW_AUTO_OPTIONS).map((option) => (
                    <Radio.Button
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled}
                    >
                        {option.label}
                    </Radio.Button>
                ))}
            </Radio.Group>
        </div>
    )
}

export default memo(EvalRunScenariosViewSelector)
