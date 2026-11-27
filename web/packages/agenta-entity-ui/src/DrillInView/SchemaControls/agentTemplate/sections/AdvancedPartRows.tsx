/**
 * The parts of Advanced as rows (Execution, Agenta tools, Build kit): the Advanced view lists them,
 * and the Configuration page shows them in the Advanced card (canvas A04). A row opens its part's
 * view.
 */
import type {ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {createT, useT} from "@agenta/i18n"
import advancedViewCatalog from "@agenta/i18n/catalogs/entityUi.advancedView"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import type {ViewDef} from "@agenta/ui/view-stack"
import {Cube, Hammer, Toolbox} from "@phosphor-icons/react"

import {getEnumOptions} from "../../EnumSelectControl"
import {useAdvancedParts} from "../advancedParts"
import {agentaToolsPreset, agentaToolsPresetLabel} from "../AgentaToolsSection"
import type {useSandboxChoice} from "../sandboxChoice"
import {
    agentaToolsView,
    buildKitView,
    executionView,
    type AdvancedViewParams,
} from "../views/advancedViews"

const tModelHarness = createT(modelHarnessCatalog)

/** One icon per part: its row in the list and the Mark on its view (ICON-05). */
export const ADVANCED_PART_ICONS = {
    execution: <Cube size={16} />,
    agentaTools: <Toolbox size={16} />,
    buildKit: <Hammer size={16} />,
}

export interface AdvancedPartRow {
    key: string
    icon: ReactNode
    title: string
    summary?: string
    view: ViewDef<AdvancedViewParams>
}

/**
 * The agent's sandbox as the Execution row and the Advanced row say it ("Sandbox: Daytona",
 * canvas F01 and A04): the schema's label of the kind the picker shows, else the kind itself.
 * Undefined when the agent names no sandbox.
 */
export const sandboxSummary = ({
    sandboxProps,
    shownSandboxKind,
}: Pick<ReturnType<typeof useSandboxChoice>, "sandboxProps" | "shownSandboxKind">):
    | string
    | undefined => {
    if (!shownSandboxKind) return undefined
    const kind =
        getEnumOptions(sandboxProps.kind).find((option) => option.value === shownSandboxKind)
            ?.label ?? shownSandboxKind
    return tModelHarness("entityUi.modelHarness.sandboxSummary", {kind})
}

/** The rows of the parts that apply to this agent, in the canvas order. */
export const useAdvancedPartRows = (
    schema: SchemaProperty | null | undefined,
    config: Record<string, unknown>,
    revisionId: string | null,
): AdvancedPartRow[] => {
    const t = useT(modelHarnessCatalog, advancedViewCatalog)
    const parts = useAdvancedParts(schema, config, revisionId)
    const {agentaTools} = parts
    const toolCount = Object.keys(agentaTools.access).length
    return (
        [
            parts.execution && {
                key: "execution",
                icon: ADVANCED_PART_ICONS.execution,
                title: t("entityUi.modelHarness.execution"),
                summary: sandboxSummary(parts.sandbox),
                view: executionView,
            },
            parts.tools && {
                key: "agenta-tools",
                icon: ADVANCED_PART_ICONS.agentaTools,
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
                icon: ADVANCED_PART_ICONS.buildKit,
                title: t("entityUi.modelHarness.buildKit"),
                view: buildKitView,
            },
        ] as (AdvancedPartRow | false)[]
    ).filter((row): row is AdvancedPartRow => Boolean(row))
}
