import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import advancedViewCatalog from "@agenta/i18n/catalogs/entityUi.advancedView"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {useViewTitle, type ViewDef, type ViewProps} from "@agenta/ui/view-stack"
import {CaretRight, Cube, Hammer, Toolbox} from "@phosphor-icons/react"

import {useAdvancedParts} from "../advancedParts"
import {agentaToolsPreset, agentaToolsPresetLabel} from "../AgentaToolsSection"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {
    agentaToolsView,
    buildKitView,
    executionView,
    type AdvancedViewParams,
} from "./advancedViews"

interface PartRow {
    key: string
    icon: ReactNode
    title: string
    summary?: string
    view: ViewDef<AdvancedViewParams>
}

const AdvancedViewBody = ({target, nav}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog, advancedViewCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const parts = useAdvancedParts(writer.schema, writer.agent, writer.revisionId)
    const {sandbox} = parts.sandbox
    const {agentaTools} = parts
    useViewTitle(t("entityUi.modelHarness.advanced"))

    const toolCount = Object.keys(agentaTools.access).length
    const rows = (
        [
            parts.execution && {
                key: "execution",
                icon: <Cube size={16} />,
                title: t("entityUi.modelHarness.execution"),
                summary: sandbox.kind
                    ? t("entityUi.modelHarness.sandboxSummary", {kind: String(sandbox.kind)})
                    : undefined,
                view: executionView,
            },
            parts.tools && {
                key: "agenta-tools",
                icon: <Toolbox size={16} />,
                title: t("entityUi.modelHarness.agentaTools"),
                summary:
                    agentaTools.status === "ready"
                        ? t("entityUi.advancedView.toolsSummary", {
                              policy: agentaToolsPresetLabel(
                                  agentaToolsPreset(agentaTools.tools, agentaTools.access),
                              ),
                              count: toolCount,
                          })
                        : undefined,
                view: agentaToolsView,
            },
            parts.buildKit && {
                key: "build-kit",
                icon: <Hammer size={16} />,
                title: t("entityUi.modelHarness.buildKit"),
                view: buildKitView,
            },
        ] as (PartRow | false)[]
    ).filter((row): row is PartRow => Boolean(row))

    return (
        <div className="flex flex-col gap-1 px-2 py-2">
            {rows.map((row) => (
                <button
                    key={row.key}
                    type="button"
                    data-testid={`advanced-part-${row.key}`}
                    disabled={!nav.push}
                    onClick={() => void nav.push?.(row.view, {}, target)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 py-2 text-left transition-colors hover:bg-[var(--ag-colorFillQuaternary)]"
                >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded bg-colorFillSecondary text-colorTextSecondary">
                        {row.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] font-medium text-colorText">
                            {row.title}
                        </span>
                        {row.summary ? (
                            <span className="truncate text-xs text-colorTextTertiary">
                                {row.summary}
                            </span>
                        ) : null}
                    </span>
                    <CaretRight size={13} className="shrink-0 text-colorTextQuaternary" />
                </button>
            ))}
        </div>
    )
}

export default AdvancedViewBody
