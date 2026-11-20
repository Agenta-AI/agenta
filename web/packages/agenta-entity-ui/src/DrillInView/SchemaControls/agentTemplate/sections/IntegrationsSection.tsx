import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Wrench} from "@phosphor-icons/react"

import type {IntegrationRow} from "../../toolUtils"
import {countSummary} from "../agentTemplateUtils"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {ToolManagementList, type ToolManagementListProps} from "../ToolManagementList"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

export interface IntegrationsSectionParams {
    t: AgentTemplateT
    hasTools: boolean
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    /** The Integrations add button. Undefined when the host wires no gateway tools. */
    openIntegrationDrawer: (() => void) | undefined
    integrationCount: number
    tools: unknown[]
    integrationRows: IntegrationRow[]
    toolStatusFor: ToolManagementListProps["statusFor"]
    gatewayToolsEnabled: boolean
    openIntegrationRow: (row: IntegrationRow) => void
    /** The row's bin: asks with {@link IntegrationRemoveDialog} first. */
    removeIntegration: (row: IntegrationRow) => void
    closeEditor: () => void
}

/** Connected apps. Shares the `tools` config array with Subagents. */
export const integrationsSection = ({
    t,
    hasTools,
    sectionIndicator,
    disabled,
    openIntegrationDrawer,
    integrationCount,
    tools,
    integrationRows,
    toolStatusFor,
    gatewayToolsEnabled,
    openIntegrationRow,
    removeIntegration,
    closeEditor,
}: IntegrationsSectionParams): SectionResult =>
    hasTools &&
    (Boolean(openIntegrationDrawer) || integrationCount > 0) && {
        key: "tools",
        icon: <Wrench size={16} />,
        title: t("entityUi.agentTemplate.integrations"),
        summary: countSummary(integrationCount, "integration"),
        indicator: sectionIndicator("tools"),
        // "Create with AI" beside the drawer that adds one by hand.
        extra:
            !disabled && openIntegrationDrawer ? (
                <CreateWithAIAddMenu
                    label={t("entityUi.agentTemplate.addIntegration")}
                    starterPrompt={t("entityUi.agentTemplate.integrationStarter")}
                    onManual={openIntegrationDrawer}
                    manualTitle={t("entityUi.agentTemplate.browseIntegrations")}
                    manualHint={t("entityUi.agentTemplate.browseIntegrationsHint")}
                    manualIcon={<Wrench size={16} />}
                />
            ) : undefined,
        defaultOpen: integrationCount > 0,
        content: (
            <ToolManagementList
                tools={tools}
                integrationRows={integrationRows}
                disabled={disabled}
                statusFor={toolStatusFor}
                onOpenIntegration={gatewayToolsEnabled ? openIntegrationRow : undefined}
                onRemoveIntegration={(row) => {
                    removeIntegration(row)
                    closeEditor()
                }}
            />
        ),
    }

/** The row bin's question (F06 f2): removing from the agent keeps the project connection. */
export const IntegrationRemoveDialog = ({
    row,
    onRemove,
    onClose,
}: {
    row: IntegrationRow
    onRemove: () => void
    onClose: () => void
}) => {
    const t = useT(integrationViewsCatalog)
    const {integration} = useToolIntegrationDetail(row.integration)
    return (
        <RemoveFromAgentDialog
            open
            name={integration?.name || row.integration}
            description={t("entityUi.integrationViews.connectionStays")}
            onRemove={onRemove}
            onClose={onClose}
        />
    )
}
