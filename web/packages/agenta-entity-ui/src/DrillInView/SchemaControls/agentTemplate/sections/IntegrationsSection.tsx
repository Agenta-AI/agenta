import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Wrench} from "@phosphor-icons/react"

import type {IntegrationRow} from "../../toolUtils"
import {countSummary} from "../agentTemplateUtils"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {ToolManagementList, type ToolManagementListProps} from "../ToolManagementList"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

const tNow = createT(commonCatalog)

export interface IntegrationsSectionParams {
    t: AgentTemplateT
    hasTools: boolean
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    /** Opens "Add integration". Undefined when the host wires no gateway tools. */
    openAddIntegration: (() => void) | undefined
    integrationCount: number
    tools: unknown[]
    integrationRows: IntegrationRow[]
    toolStatusFor: ToolManagementListProps["statusFor"]
    gatewayToolsEnabled: boolean
    openIntegrationRow: (row: IntegrationRow) => void
    /** The row's bin: asks with {@link IntegrationRemoveDialog} before anything is removed. */
    askRemoveIntegration: (row: IntegrationRow) => void
}

/** Connected apps. Shares the `tools` config array with Subagents. */
export const integrationsSection = ({
    t,
    hasTools,
    sectionIndicator,
    disabled,
    openAddIntegration,
    integrationCount,
    tools,
    integrationRows,
    toolStatusFor,
    gatewayToolsEnabled,
    openIntegrationRow,
    askRemoveIntegration,
}: IntegrationsSectionParams): SectionResult =>
    hasTools &&
    (Boolean(openAddIntegration) || integrationCount > 0) && {
        key: "tools",
        icon: <Wrench size={16} />,
        title: t("entityUi.agentTemplate.integrations"),
        // "None" when empty, as the canvas draws the Agent tab.
        summary: countSummary(integrationCount, "integration") || tNow("common.none"),
        indicator: sectionIndicator("tools"),
        // "Create with AI" beside the view that adds one by hand.
        extra:
            !disabled && openAddIntegration ? (
                <CreateWithAIAddMenu
                    label={t("entityUi.agentTemplate.addIntegration")}
                    starterPrompt={t("entityUi.agentTemplate.integrationStarter")}
                    onManual={openAddIntegration}
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
                onRemoveIntegration={askRemoveIntegration}
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
            description={
                // An entry with each person's own account names no project connection.
                row.entry?.accountSource === "user"
                    ? t("entityUi.integrationViews.accountsStay")
                    : t("entityUi.integrationViews.connectionStays")
            }
            onRemove={onRemove}
            onClose={onClose}
        />
    )
}
