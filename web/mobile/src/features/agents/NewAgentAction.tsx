import {useState} from "react"

import {uploadAttachment} from "@agenta/chat/assets"
import type {AgentTemplateSource} from "@agenta/entities/workflow"
import {NewAgentButton, type NewAgentButtonProps} from "@agenta/home-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

import {newId} from "@/lib/ids"

import {AgentTemplateImportDrawer} from "./AgentTemplateImportDrawer"

/**
 * The SHARED create menu, bound to this app's create: from scratch, an uploaded template .zip, or a
 * template found in a GitHub repository. The gallery sits at the project root, NOT under `/agents`,
 * so browsing it does not light the Agents nav entry.
 */
export const NewAgentAction = ({
    create,
    createFromSource,
    creating,
    error,
    label,
    base,
    align = "stretch",
    variant,
    size,
    className,
}: {
    create: () => void
    createFromSource: (source: AgentTemplateSource) => Promise<boolean>
    creating: boolean
    error: string | null
    label?: string
    /** `/w/:workspace/p/:project` — the gallery link's base. */
    base: string
    /** A header row wants it hugging the right edge; a rail wants it filling the column. */
    align?: "end" | "stretch"
    variant?: NewAgentButtonProps["variant"]
    size?: NewAgentButtonProps["size"]
    /** On the trigger — the roster toolbar sizes it down on a phone. */
    className?: string
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const [importOpen, setImportOpen] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)

    const upload = async (file: File) => {
        if (!projectId) return
        setUploading(true)
        setUploadError(null)
        try {
            // A fresh staging scope: the agent and its session do not exist yet.
            const stagingSessionId = newId()
            const {attachment} = await uploadAttachment({
                file,
                sessionId: stagingSessionId,
                projectId,
                idempotencyKey: newId(),
            })
            await createFromSource({
                kind: "upload",
                staging_session_id: stagingSessionId,
                attachment_id: attachment.attachment_id,
            })
        } catch (err) {
            setUploadError(extractApiErrorMessage(err))
        } finally {
            setUploading(false)
        }
    }

    const shownError = uploadError ?? error
    return (
        <span
            className={`flex flex-col gap-1 ${align === "end" ? "shrink-0 items-end" : "items-stretch"}`}
        >
            <NewAgentButton
                className={className}
                label={label}
                variant={variant}
                size={size}
                loading={creating || uploading}
                onCreateBlank={create}
                onUpload={(file) => void upload(file)}
                onImport={() => setImportOpen(true)}
                browseHref={`${base}/templates`}
            />
            {shownError ? <span className="text-destructive text-[11px]">{shownError}</span> : null}
            <AgentTemplateImportDrawer
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onPick={createFromSource}
            />
        </span>
    )
}
