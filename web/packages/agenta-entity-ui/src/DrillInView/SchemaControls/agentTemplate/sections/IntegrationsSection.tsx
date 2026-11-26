import {Fragment} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {createT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {humanizeActionKey} from "@agenta/shared/utils"
import {AppWindow, Plus, Wrench} from "@phosphor-icons/react"

import type {IntegrationRow} from "../../toolUtils"
import {countSummary} from "../agentTemplateUtils"
import {CreateWithAIAddMenu} from "../CreateWithAIAddMenu"
import {IntegrationLogoStack} from "../IntegrationLogoStack"
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
    /** The row's bin: asks with the remove dialog before anything is removed. */
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
        // "None" when empty, as the canvas draws the phone (M07) and the builder pane (B03).
        summary: countSummary(integrationCount, "integration") || tNow("common.none"),
        empty: integrationCount === 0,
        // The connected apps' logos stand in for the count.
        panelSummary: integrationRows.length ? (
            <IntegrationLogoStack
                rows={integrationRows}
                label={countSummary(integrationCount, "integration")}
            />
        ) : undefined,
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
        emptyAction:
            !disabled && openAddIntegration
                ? {label: t("entityUi.agentTemplate.addIntegration"), onClick: openAddIntegration}
                : undefined,
        pageAction:
            !disabled && openAddIntegration ? (
                <SectionPageAction action="add" onClick={openAddIntegration} />
            ) : undefined,
        // On a phone the one primary action at the bottom opens the catalog (M08).
        phoneAction:
            !disabled && openAddIntegration
                ? {
                      label: t("entityUi.agentTemplate.addIntegration"),
                      // A 14 px plus (canvas M08); a size class keeps the button from resizing it.
                      icon: <Plus className="size-3.5" />,
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

/** The app's name as its card writes it ("Zendesk", not the slug "zendesk"). */
const IntegrationName = ({slug}: {slug: string}) => {
    const {integration} = useToolIntegrationDetail(slug)
    return <>{integration?.name || humanizeActionKey(slug)}</>
}
