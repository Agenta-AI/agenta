import {useState, type FormEvent, type ReactNode} from "react"

import {queryWorkflows, workflowMolecule} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue, useStore} from "jotai"
import dynamic from "next/dynamic"

import {useCreateEvaluatorFromTemplate} from "./useCreateEvaluatorFromTemplate"

// Each step is its own chunk: a host screen downloads none of it until a user creates.
const EvaluatorTemplatePicker = dynamic(
    () => import("./EvaluatorTemplatePicker").then((m) => m.EvaluatorTemplatePicker),
    {ssr: false},
)
const EvaluatorEditorDrawer = dynamic(
    () => import("./EvaluatorEditorDrawer").then((m) => m.EvaluatorEditorDrawer),
    {ssr: false},
)
const HumanEvaluatorSheet = dynamic(
    () => import("../human/HumanEvaluatorSheet").then((m) => m.HumanEvaluatorSheet),
    {ssr: false},
)

/**
 * React events bubble through portals: a submit in these sheets would reach a form the host
 * renders around the flow (the new queue form, the New evaluation form) and submit it too.
 */
const Contained = ({children}: {children: ReactNode}) => (
    <div className="contents" onSubmit={(event: FormEvent) => event.stopPropagation()}>
        {children}
    </div>
)

/** A new evaluator, as a picker selects it. */
export interface CreatedEvaluator {
    workflowId: string
    revisionId: string
    name: string
    slug: string
    version: number
}

/**
 * Create an evaluator from another screen (New evaluation, a new annotation queue, Annotate) and
 * hand it back selected. Automatic: the template picker, then the editable drawer with the test
 * pane and the naming step. Human: the feedback form. Mount it while the user creates; it calls
 * `onClose` when they finish or leave.
 *
 * The automatic flow puts its evaluator in the playground state, unless `onPlayground` says the
 * host shows a playground of its own: the drawer then has no test pane and leaves that state alone.
 */
export const CreateEvaluatorFlow = ({
    kind,
    onCreated,
    onClose,
    onPlayground = false,
}: {
    kind: "automatic" | "human"
    onCreated: (evaluator: CreatedEvaluator) => void
    onClose: () => void
    /** Created from a page with its own playground: the drawer has no test pane there. */
    onPlayground?: boolean
}) => {
    const store = useStore()
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [draftId, setDraftId] = useState<string | null>(null)
    const template = useCreateEvaluatorFromTemplate(setDraftId)

    if (kind === "human") {
        return (
            <Contained>
                <HumanEvaluatorSheet
                    open
                    editing={null}
                    onClose={onClose}
                    onSaved={(created) => {
                        if (created) onCreated(created)
                    }}
                />
            </Contained>
        )
    }

    if (!draftId) {
        return (
            <Contained>
                <EvaluatorTemplatePicker
                    open
                    pendingKey={template.pendingKey}
                    onOpenChange={(open) => (open ? undefined : onClose())}
                    onPick={(picked) => void template.start(picked)}
                />
            </Contained>
        )
    }

    return (
        <Contained>
            <EvaluatorEditorDrawer
                projectId={projectId}
                revisionId={draftId}
                onPlayground={onPlayground}
                playgroundBase={null}
                onNavigate={() => undefined}
                onClose={onClose}
                onSaved={(revisionId) => {
                    // The create primed the new revision in the cache. The evaluator's own name
                    // is on its workflow, which nothing has loaded yet.
                    const data = store.get(workflowMolecule.selectors.data(revisionId))
                    const workflowId = data?.workflow_id ?? ""
                    const finish = (name: string | null | undefined) => {
                        onCreated({
                            workflowId,
                            revisionId,
                            name: name || "Evaluator",
                            slug: data?.slug ?? "",
                            version: data?.version ?? 1,
                        })
                        onClose()
                    }
                    if (!workflowId) {
                        finish(null)
                        return
                    }
                    // Only a failed lookup falls back to no name: an error thrown by the host
                    // callbacks must not run them a second time.
                    queryWorkflows({projectId, workflowRefs: [{id: workflowId}]})
                        .then(
                            (response) => response.workflows?.[0]?.name,
                            () => null,
                        )
                        .then(finish)
                        .catch((error) =>
                            console.error("Handing back the new evaluator failed", error),
                        )
                }}
            />
        </Contained>
    )
}
