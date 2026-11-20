import {Fragment} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {AppWindow, Plus, Wrench} from "@phosphor-icons/react"

import type {IntegrationRow} from "../../toolUtils"
import {countSummary} from "../agentTemplateUtils"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {SectionPageAction} from "../SectionPageAction"
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
        icon: <Wrench size={14} />,
        title: t("entityUi.agentTemplate.integrations"),
        // "None" when empty, as the canvas draws the Agent tab.
        summary: countSummary(integrationCount, "integration") || tNow("common.none"),
        // The phone row names the integrations (M07: "Zendesk").
        phoneSummary: integrationRows.length ? (
            <IntegrationNames rows={integrationRows} />
        ) : (
            tNow("common.none")
        ),
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
                    manualIcon={<AppWindow size={14} />}
                />
            ) : undefined,
        pageAction:
            !disabled && openAddIntegration ? (
                <SectionPageAction action="add" onClick={openAddIntegration} />
            ) : undefined,
        // On a phone the one primary action at the bottom opens the catalog (M08).
        phoneAction:
            !disabled && openAddIntegration
                ? {
                      label: t("entityUi.agentTemplate.addIntegration"),
                      icon: <Plus size={14} />,
                      onClick: openAddIntegration,
                  }
                : undefined,
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

/** The integrations' names, comma separated. */
const IntegrationNames = ({rows}: {rows: IntegrationRow[]}) => (
    <>
        {rows.map((row, index) => (
            <Fragment key={row.integration}>
                {index > 0 ? ", " : null}
                <IntegrationName slug={row.integration} />
            </Fragment>
        ))}
    </>
)

const IntegrationName = ({slug}: {slug: string}) => {
    const {integration} = useToolIntegrationDetail(slug)
    return <>{integration?.name || slug}</>
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
