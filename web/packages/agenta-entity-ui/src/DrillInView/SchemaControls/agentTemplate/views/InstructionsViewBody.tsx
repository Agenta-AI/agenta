import {useState} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import instructionsViewCatalog from "@agenta/i18n/catalogs/entityUi.instructionsView"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
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
    const t = useT(instructionsViewCatalog, configItemsCatalog, schemaControlsCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    // The text the view opened with. A builder save meanwhile does not reset the person's edits.
    const [original] = useState(
        () => (instructionsOf(writer.agent).agents_md as string | null | undefined) ?? "",
    )
    const [draft, setDraft] = useState(original)
    const [view, setView] = useState<"rendered" | "source">("rendered")
    const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
    // Read only (a Viewer, or a phone) shows the text with no editor toolbar.
    const showToolbar = !writer.readOnly
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
    // Edge to edge (F01 f3): the toolbar band sits under the breadcrumb, with no frame around the
    // text. `md-prose-panel` sets the panel text scale (editor-theme.css).
    return (
        <div className="md-prose-panel flex min-h-0 flex-1 flex-col">
            {showToolbar ? (
                <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary bg-[var(--ag-surface-raised)] px-2.5 py-1.5">
                    <div ref={setToolbarHost} className="min-w-0 flex-1" />
                    <button
                        type="button"
                        onClick={() => setView((v) => (v === "source" ? "rendered" : "source"))}
                        className="shrink-0 cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 font-[inherit] text-[12px] font-medium text-colorText underline underline-offset-2 hover:bg-colorFillTertiary"
                    >
                        {view === "source"
                            ? t("entityUi.schemaControls.richText")
                            : t("entityUi.schemaControls.source")}
                    </button>
                </div>
            ) : null}
            <MarkdownEditor
                value={draft}
                onChange={setDraft}
                disabled={writer.readOnly}
                autoFocus={!writer.readOnly}
                showToolbar={showToolbar}
                toolbarContainer={showToolbar ? toolbarHost : undefined}
                view={view}
                onViewChange={setView}
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
