import {useState} from "react"

import {playgroundController} from "@agenta/playground"
import {EvaluatorPicker} from "@agenta/playground-ui/panels/evaluator"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue, useStore} from "jotai"
import dynamic from "next/dynamic"

import type {CreatedEvaluator} from "./CreateEvaluatorFlow"

// The create flow is its own chunk: the playground downloads it only when a user creates.
const CreateEvaluatorFlow = dynamic(
    () => import("./CreateEvaluatorFlow").then((module) => module.CreateEvaluatorFlow),
    {ssr: false},
)

/**
 * The app playground's evaluator picker. In beta developer mode it also offers "Create new
 * evaluator": the template picker, then the editable drawer without a test pane (the playground
 * keeps its state), and the new evaluator runs after the app, as a picked one does.
 */
export const PlaygroundEvaluatorPicker = () => {
    const store = useStore()
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const [creating, setCreating] = useState(false)

    const connect = (created: CreatedEvaluator) => {
        const root = store
            .get(playgroundController.selectors.nodes())
            .find((node) => node.depth === 0)
        if (!root) return
        store.set(playgroundController.actions.connectDownstreamNode, {
            sourceNodeId: root.id,
            entity: {type: "workflow", id: created.revisionId, label: created.name},
        })
    }

    return (
        <>
            <EvaluatorPicker onCreateNew={beta ? () => setCreating(true) : undefined} />
            {creating ? (
                <CreateEvaluatorFlow
                    kind="automatic"
                    onPlayground
                    onCreated={connect}
                    onClose={() => setCreating(false)}
                />
            ) : null}
        </>
    )
}
