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
    handleAddMcpServer: () => void
    agentPermissionPolicy: McpServersSectionBodyProps["agentPolicy"]
    setAgentField: (key: string, fieldValue: unknown) => void
    openEdit: (kind: "mcp", index: number, item: unknown) => void
    removeItem: (kind: "mcp", index: number) => void
    closeEditor: () => void
    mcpStatusFor: McpServersSectionBodyProps["statusFor"]
    addMcpOpen: boolean
    setAddMcpOpen: (open: boolean) => void
}

/** The agent's MCP servers (`mcps`). Named apart from the Settings `McpServersSection`. */
export const agentMcpSection = ({
    t,
    hasMcp,
    fieldTitle,
    sectionIndicator,
    disabled,
    mcpServers,
    handleAddMcpServer,
    agentPermissionPolicy,
    setAgentField,
    openEdit,
    removeItem,
    closeEditor,
    mcpStatusFor,
    addMcpOpen,
    setAddMcpOpen,
}: AgentMcpSectionParams): SectionResult =>
    hasMcp && {
        key: "mcp",
        icon: <HardDrives size={16} />,
        title: fieldTitle("mcps", t("entityUi.agentTemplate.mcpServers")),
        summary: countSummary(mcpServers.length, "server"),
        indicator: sectionIndicator("mcp"),
        extra: !disabled ? (
            <SectionAddButton
                label={t("entityUi.agentTemplate.addMcpServer")}
                onClick={handleAddMcpServer}
            />
        ) : undefined,
        defaultOpen: mcpServers.length > 0,
        content: (
            <McpServersSectionBody
                items={mcpServers}
                disabled={disabled}
                agentPolicy={agentPermissionPolicy}
                onChangeItems={(next: unknown[]) => setAgentField("mcps", next)}
                openForm={(index: number, item: unknown) => openEdit("mcp", index, item)}
                removeItem={(index: number) => removeItem("mcp", index)}
                closeEditor={closeEditor}
                statusFor={mcpStatusFor}
                addOpen={addMcpOpen}
                onAddClose={() => setAddMcpOpen(false)}
                onAddOpen={() => setAddMcpOpen(true)}
            />
        ),
    }
