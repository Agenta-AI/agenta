import {useState} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import instructionsViewCatalog from "@agenta/i18n/catalogs/entityUi.instructionsView"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {MarkdownBodySkeleton, MarkdownToolbarSkeleton} from "../../DrawerSkeletons"
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
                // Tone alone sets the band apart (SURF-01); the left edge and the text sit at 16px.
                <div className="flex shrink-0 items-center gap-1 bg-muted py-1.5 pl-4 pr-2">
                    <div className="relative min-w-0 flex-1">
                        <div ref={setToolbarHost} className="peer min-w-0" />
                        {/* The tools' shape holds the band until the editor puts them in. */}
                        <MarkdownToolbarSkeleton className="absolute inset-y-0 left-0 hidden peer-empty:flex" />
                    </div>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setView((v) => (v === "source" ? "rendered" : "source"))}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        {view === "source"
                            ? t("entityUi.schemaControls.richText")
                            : t("entityUi.schemaControls.source")}
                    </Button>
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
                loadingSkeleton={<MarkdownBodySkeleton />}
                placeholder={t("entityUi.instructionsView.placeholder")}
            />
        </div>
    )
}

export default InstructionsViewBody
