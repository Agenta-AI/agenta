import {HardDrives} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import {McpServersSectionBody, type McpServersSectionBodyProps} from "../McpServersSectionBody"
import {SectionAddButton} from "../SectionAddButton"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

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
        icon: <HardDrives size={16} />,
        title: fieldTitle("mcps", t("entityUi.agentTemplate.mcpServers")),
        summary: countSummary(mcpServers.length, "server"),
        indicator: sectionIndicator("mcp"),
        extra:
            !disabled && openAddMcpServer ? (
                <SectionAddButton
                    label={t("entityUi.agentTemplate.addMcpServer")}
                    onClick={openAddMcpServer}
                />
            ) : undefined,
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
