import {useState} from "react"

import {NewAgentButton, type NewAgentButtonProps} from "@agenta/home-ui"
import {useSetAtom} from "jotai"

import {AgentTemplateImportDrawer} from "./AgentTemplateImportDrawer"
import {openImportTemplateAtom} from "./importTemplateRequest"
import type {useNewAgentAction} from "./useNewAgentAction"

/**
 * The SHARED create menu, bound to this app's create. The gallery sits at the project root, NOT
 * under `/agents`, so browsing it does not light the Agents nav entry.
 */
export const NewAgentAction = ({
    newAgent,
    base,
    align = "stretch",
    ...button
}: {
    newAgent: ReturnType<typeof useNewAgentAction>
    /** `/w/:workspace/p/:project` — the gallery link's base. */
    base: string
    /** A header row wants it hugging the right edge; a rail wants it filling the column. */
    align?: "end" | "stretch"
} & Pick<NewAgentButtonProps, "variant" | "size" | "className">) => {
    const [importOpen, setImportOpen] = useState(false)
    const openImportTemplate = useSetAtom(openImportTemplateAtom)
    return (
        <span
            className={`flex flex-col gap-1 ${align === "end" ? "shrink-0 items-end" : "items-stretch"}`}
        >
            <NewAgentButton
                {...button}
                loading={newAgent.creating}
                onCreateBlank={newAgent.create}
                onUpload={(file) => openImportTemplate({kind: "upload", file})}
                onImport={() => setImportOpen(true)}
                browseHref={`${base}/templates`}
            />
            {newAgent.error ? (
                <span className="text-destructive text-[11px]">{newAgent.error}</span>
            ) : null}
            <AgentTemplateImportDrawer
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onPick={newAgent.createFromSource}
            />
        </span>
    )
}
