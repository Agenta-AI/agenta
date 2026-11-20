/**
 * The parts of Advanced as rows (Execution, Agenta tools, Build kit): the Advanced view lists them,
 * and the Configuration page shows them in the Advanced card (canvas A04). A row opens its part's
 * view.
 */
import type {ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {useT} from "@agenta/i18n"
import advancedViewCatalog from "@agenta/i18n/catalogs/entityUi.advancedView"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import type {ViewDef} from "@agenta/ui/view-stack"
import {Cube, Hammer, Toolbox} from "@phosphor-icons/react"

import {useAdvancedParts} from "../advancedParts"
import {agentaToolsPreset, agentaToolsPresetLabel} from "../AgentaToolsSection"
import {
    agentaToolsView,
    buildKitView,
    executionView,
    type AdvancedViewParams,
} from "../views/advancedViews"

export interface AdvancedPartRow {
    key: string
    icon: ReactNode
    title: string
    summary?: string
    view: ViewDef<AdvancedViewParams>
}

/** The rows of the parts that apply to this agent, in the canvas order. */
export const useAdvancedPartRows = (
    schema: SchemaProperty | null | undefined,
    config: Record<string, unknown>,
    revisionId: string | null,
): AdvancedPartRow[] => {
    const t = useT(modelHarnessCatalog, advancedViewCatalog)
    const parts = useAdvancedParts(schema, config, revisionId)
    const {sandbox} = parts.sandbox
    const {agentaTools} = parts
    const toolCount = Object.keys(agentaTools.access).length
    return (
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
        ] as (AdvancedPartRow | false)[]
    ).filter((row): row is AdvancedPartRow => Boolean(row))
}
