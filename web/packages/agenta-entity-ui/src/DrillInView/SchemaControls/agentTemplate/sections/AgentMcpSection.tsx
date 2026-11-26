import {createT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Broadcast, Plus} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import {McpServersSectionBody, type McpServersSectionBodyProps} from "../McpServersSectionBody"
import {SectionAddButton} from "../SectionAddButton"
import {SectionPageAction} from "../SectionPageAction"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

// Read when the section is built, so it is in the active language.
const tNow = createT(commonCatalog)

export interface AgentMcpSectionParams {
    t: AgentTemplateT
    hasMcp: boolean
    fieldTitle: (field: string, fallback: string) => string
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    mcpServers: unknown[]
    /** Opens "Add MCP server". Undefined when the host has no view target. */
    openAddMcpServer: (() => void) | undefined
    openMcpServer: McpServersSectionBodyProps["openServer"]
    removeMcpServer: McpServersSectionBodyProps["removeServer"]
    removeMcpServerAt: McpServersSectionBodyProps["removeServerAt"]
    openForm: McpServersSectionBodyProps["openForm"]
    mcpStatusFor: McpServersSectionBodyProps["statusFor"]
}

/** The agent's MCP servers (`mcps`). Named apart from the Settings `McpServersSection`. */
export const agentMcpSection = ({
    t,
    hasMcp,
    fieldTitle,
    sectionIndicator,
    disabled,
    mcpServers,
    openAddMcpServer,
    openMcpServer,
    removeMcpServer,
    removeMcpServerAt,
    openForm,
    mcpStatusFor,
}: AgentMcpSectionParams): SectionResult =>
    hasMcp && {
        key: "mcp",
        icon: <Broadcast size={14} />,
        title: fieldTitle("mcps", t("entityUi.agentTemplate.mcpServers")),
        // "None" when empty, as the canvas draws the Agent tab.
        summary: countSummary(mcpServers.length, "server") || tNow("common.none"),
        empty: mcpServers.length === 0,
        indicator: sectionIndicator("mcp"),
        extra:
            !disabled && openAddMcpServer ? (
                <SectionAddButton
                    label={t("entityUi.agentTemplate.addMcpServer")}
                    onClick={openAddMcpServer}
                />
            ) : undefined,
        emptyAction:
            !disabled && openAddMcpServer
                ? {label: t("entityUi.agentTemplate.addMcpServer"), onClick: openAddMcpServer}
                : undefined,
        pageAction:
            !disabled && openAddMcpServer ? (
                <SectionPageAction action="add" onClick={openAddMcpServer} />
            ) : undefined,
        phoneAction:
            !disabled && openAddMcpServer
                ? {
                      label: t("entityUi.agentTemplate.addMcpServer"),
                      icon: <Plus className="size-3.5" />,
                      onClick: openAddMcpServer,
                  }
                : undefined,
        defaultOpen: mcpServers.length > 0,
        content: (
            <McpServersSectionBody
                items={mcpServers}
                disabled={disabled}
                openForm={openForm}
                openServer={openMcpServer}
                removeServer={removeMcpServer}
                removeServerAt={removeMcpServerAt}
                statusFor={mcpStatusFor}
            />
        ),
    }
