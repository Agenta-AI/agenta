import {useCallback, useMemo, useRef} from "react"

import {createWorkflowFromEphemeralAtom, workflowMolecule} from "@agenta/entities/workflow"
import {EntityCommitModal} from "@agenta/entity-ui/modals"
import type {CommitSubmitParams, CommitSubmitResult} from "@agenta/entity-ui/modals"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {promptsCopy} from "./promptsCopy"

const CREATE_FIELDS = {nameLabel: promptsCopy.createPromptDialog.nameLabel}

/**
 * The naming step of New prompt: the shared commit dialog in its create form (name, slug,
 * message). Create makes the app from the local draft in one call and hands back its ids.
 *
 * /w names the draft in its editable revision drawer, which can also change the prompt before the
 * create. When /m has that drawer, it takes this dialog's place; the draft and `onCreated` stay.
 */
export const CreatePromptDialog = ({
    draftId,
    onClose,
    onCreated,
}: {
    draftId: string
    onClose: () => void
    onCreated: (appId: string, revisionId: string) => void
}) => {
    const queryClient = useQueryClient()
    const createFromDraft = useSetAtom(createWorkflowFromEphemeralAtom)
    const draft = useAtomValue(workflowMolecule.selectors.data(draftId))
    const createdAppId = useRef<string | null>(null)
    const entity = useMemo(
        () => ({type: "variant" as const, id: draftId, name: draft?.name ?? ""}),
        [draftId, draft?.name],
    )

    const submit = useCallback(
        async ({message, entityName, entitySlug}: CommitSubmitParams) => {
            const result = await createFromDraft({
                revisionId: draftId,
                commitMessage: message ?? undefined,
                name: entityName,
                slug: entitySlug,
            })
            if (!result.success) {
                return {
                    success: false,
                    error: promptsCopy.failure.createPrompt,
                    errorStatus: (result.error as {response?: {status?: number}}).response?.status,
                }
            }
            createdAppId.current = result.workflow?.workflow_id ?? null
            // The Prompts list reads its own query; refresh it so a return to it shows the app.
            void queryClient.invalidateQueries({queryKey: ["workflows"]})
            return {success: true, newRevisionId: result.newRevisionId}
        },
        [createFromDraft, draftId, queryClient],
    )

    const afterCreate = useCallback(
        ({newRevisionId}: CommitSubmitResult) => {
            const appId = createdAppId.current
            if (appId && newRevisionId) onCreated(appId, newRevisionId)
        },
        [onCreated],
    )

    return (
        <EntityCommitModal
            open
            onClose={onClose}
            entity={entity}
            onSubmit={submit}
            onAfterSuccess={afterCreate}
            actionLabel={promptsCopy.createPromptDialog.create}
            createEntityFields={CREATE_FIELDS}
            successMessage={promptsCopy.toast.promptCreated}
        />
    )
}
