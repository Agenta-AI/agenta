import {useState} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import instructionsViewCatalog from "@agenta/i18n/catalogs/entityUi.instructionsView"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {MarkdownEditorSkeleton} from "../../DrawerSkeletons"
import {MarkdownEditor} from "../../MarkdownEditor"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {InstructionsViewParams} from "./instructionsView"

const instructionsOf = (agent: Record<string, unknown>): Record<string, unknown> =>
    agent.instructions && typeof agent.instructions === "object"
        ? (agent.instructions as Record<string, unknown>)
        : {}

/**
 * Edits a copy of AGENTS.md. Save applies it to the agent configuration; auto-save then saves the
 * version. Cancel drops the copy.
 */
const InstructionsViewBody = ({params, target}: ViewProps<InstructionsViewParams>) => {
    const t = useT(instructionsViewCatalog, configItemsCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    // The text the view opened with. A builder save meanwhile does not reset the person's edits.
    const [original] = useState(
        () => (instructionsOf(writer.agent).agents_md as string | null | undefined) ?? "",
    )
    const [draft, setDraft] = useState(original)
    useViewTitle(params.file)
    useViewForm({
        dirty: draft !== original,
        valid: !writer.readOnly,
        leaveDescription: t("entityUi.configItems.saveOrDiscardDraft"),
        save: async () => {
            writer.update((agent) => ({
                ...agent,
                instructions: {...instructionsOf(agent), agents_md: draft},
            }))
            return true
        },
    })
    return (
        <div className="flex min-h-0 flex-1 flex-col px-3 pt-2">
            <MarkdownEditor
                value={draft}
                onChange={setDraft}
                disabled={writer.readOnly}
                autoFocus={!writer.readOnly}
                // Read only (a Viewer, or a phone) shows the text with no editor toolbar.
                showToolbar={!writer.readOnly}
                defaultView="rendered"
                hideHeader
                bordered={false}
                grow
                loadingSkeleton={<MarkdownEditorSkeleton />}
                placeholder={t("entityUi.instructionsView.placeholder")}
            />
        </div>
    )
}

export default InstructionsViewBody
