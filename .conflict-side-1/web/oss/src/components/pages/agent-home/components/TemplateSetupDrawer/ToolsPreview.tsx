import {useState} from "react"

import {CollapsibleProviderGroup, SubSectionHeader} from "@agenta/entity-ui/drawers/shared"

import {PROVIDERS, templateToolCount, type AgentTemplate} from "../../assets/templates"

/**
 * Read-only preview of the tools a template uses, grouped by provider — mirrors the agent config
 * panel's Tools section (uppercase "Connected apps" header → collapsible provider cards → per-tool
 * rows) but without the edit/add affordances. First provider group is expanded by default.
 */
const ToolsPreview = ({template}: {template: AgentTemplate}) => {
    const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(template.requiredIntegrations.map((i, idx) => [i.slug, idx === 0])),
    )

    return (
        <div className="flex flex-col gap-2">
            <SubSectionHeader label="Connected apps" count={templateToolCount(template)} />
            {template.requiredIntegrations.map((integration) => {
                const provider = PROVIDERS[integration.slug]
                const open = expanded[integration.slug] ?? false
                return (
                    <CollapsibleProviderGroup
                        key={integration.slug}
                        logo={provider?.logo}
                        name={provider?.label ?? integration.slug}
                        countText={`${integration.tools.length} ${
                            integration.tools.length === 1 ? "tool" : "tools"
                        }`}
                        open={open}
                        onToggle={() =>
                            setExpanded((prev) => ({...prev, [integration.slug]: !open}))
                        }
                    >
                        {integration.tools.map((tool) => (
                            <div key={tool.name} className="flex flex-col gap-0.5 px-2 py-1.5">
                                <span className="text-xs text-[var(--ag-colorText)]">
                                    {tool.name}
                                </span>
                                <span className="line-clamp-1 text-[11px] text-[var(--ag-colorTextTertiary)]">
                                    {tool.description}
                                </span>
                            </div>
                        ))}
                    </CollapsibleProviderGroup>
                )
            })}
        </div>
    )
}

export default ToolsPreview
