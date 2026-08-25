import {useCallback, useEffect, useMemo, useState} from "react"

import {detectAccountsFromTemplate, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {RailField} from "@agenta/entity-ui/drawers/shared"
import {AccountRow} from "@agenta/entity-ui/onboarding"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {FileText, Lightning, PlugsConnected, Wrench} from "@phosphor-icons/react"
import {Button, Input, Tag, Typography} from "antd"

import ModelRow from "./ModelRow"
import ToolsPreview from "./ToolsPreview"

export interface TemplateSetupResult {
    template: AgentStarterTemplate
    name: string
}

interface TemplateSetupDrawerProps {
    template: AgentStarterTemplate | null
    open: boolean
    onClose: () => void
    /** Persist + open the playground. Model is Agenta-managed (Ready); integrations may be skipped. */
    onCreate: (result: TemplateSetupResult) => void | Promise<void>
}

/**
 * "Set up {template}" drawer: review the template + connect what it needs, then Create.
 *
 * Shares the agent-playground config-drawer chrome ({@link ConfigItemDrawer}): the elevated
 * `EnhancedDrawer` with an identity header (monogram + title + type badge + meta subtitle) and a
 * native footer (muted note left, actions right). State lives here so the native footer can read
 * it; it resets whenever the open template changes.
 */
const TemplateSetupDrawer = ({template, open, onClose, onCreate}: TemplateSetupDrawerProps) => {
    const [name, setName] = useState("")
    const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({})
    const [creating, setCreating] = useState(false)

    // Seed the name + clear connection state each time a new template opens.
    useEffect(() => {
        if (template) {
            setName(template.key)
            setConnectedMap({})
            setCreating(false)
        }
    }, [template?.key])

    const handleCreate = useCallback(async () => {
        if (!template) return
        setCreating(true)
        try {
            await onCreate({template, name: name.trim()})
        } finally {
            setCreating(false)
        }
    }, [template, name, onCreate])

    const handleConnectedChange = useCallback((slug: string, connected: boolean) => {
        setConnectedMap((prev) => (prev[slug] === connected ? prev : {...prev, [slug]: connected}))
    }, [])

    // The same account shape the pre-create setup card renders, so both surfaces show one row.
    const accounts = useMemo(
        () => (template ? detectAccountsFromTemplate(template) : []),
        [template],
    )

    const leftCount = useMemo(
        () => accounts.filter((account) => !connectedMap[account.slug]).length,
        [accounts, connectedMap],
    )
    const allSet = leftCount === 0
    const nameValid = name.trim().length > 0
    // Create is gated: every required item connected + a valid name.
    const canCreate = allSet && nameValid

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            // Explicit Cancel/Create only — an outside click must not discard an in-progress setup.
            closeOnLayoutClick={false}
            width={600}
            title={
                template ? (
                    <div className="flex min-w-0 items-center gap-2">
                        <span
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
                            style={{backgroundColor: template.color}}
                        >
                            {template.initials}
                        </span>
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium">
                                    Set up {template.name}
                                </span>
                                <Tag className="m-0 shrink-0 text-xs font-normal">
                                    {template.category}
                                </Tag>
                            </div>
                            <div className="truncate text-xs font-normal text-[var(--ag-colorTextTertiary)]">
                                {template.toolsSummary} · {template.trigger}
                            </div>
                        </div>
                    </div>
                ) : null
            }
            footer={
                template ? (
                    <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-[var(--ag-colorTextTertiary)]">
                            {canCreate
                                ? "Ready to run — Create opens the playground."
                                : !allSet
                                  ? `Connect ${leftCount} integration${leftCount > 1 ? "s" : ""} to create.`
                                  : "Enter an agent name to create."}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                            <Button onClick={onClose} disabled={creating}>
                                Cancel
                            </Button>
                            <Button
                                type="primary"
                                disabled={!canCreate}
                                loading={creating}
                                onClick={handleCreate}
                            >
                                Create agent
                            </Button>
                        </div>
                    </div>
                ) : null
            }
            styles={{body: {padding: 16}}}
        >
            {template ? (
                <div key={template.key} className="flex flex-col">
                    <Typography.Paragraph className="!mb-4 text-xs leading-relaxed text-[var(--ag-colorTextSecondary)]">
                        {template.overview}
                    </Typography.Paragraph>

                    {/* Name — the primary editable field, at root level like the sibling drawers. */}
                    <div className="border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] pb-4">
                        <RailField label="Agent name" align="center">
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                status={nameValid ? undefined : "error"}
                            />
                            {nameValid ? null : (
                                <span className="mt-1 text-xs text-[var(--ag-colorError)]">
                                    Enter a name for the agent.
                                </span>
                            )}
                        </RailField>
                    </div>

                    {/* Instructions — can be long, so it collapses and its body scrolls internally. */}
                    <ConfigAccordionSection
                        size="compact"
                        icon={<FileText size={15} />}
                        title="Instructions"
                        summary={template.instructions}
                        summaryCollapsedOnly
                    >
                        <div className="max-h-[180px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] px-3 py-2 text-xs leading-relaxed text-[var(--ag-colorText)]">
                            {template.instructions}
                        </div>
                    </ConfigAccordionSection>

                    {/* Tools — provider groups with per-tool rows (read-only preview). */}
                    <ConfigAccordionSection
                        size="compact"
                        icon={<Wrench size={15} />}
                        title="Tools"
                        summary={template.toolsSummary}
                        summaryCollapsedOnly
                    >
                        <ToolsPreview template={template} />
                    </ConfigAccordionSection>

                    {/* Trigger — when the agent runs. */}
                    <ConfigAccordionSection
                        size="compact"
                        icon={<Lightning size={15} />}
                        title="Trigger"
                        summary={template.trigger}
                        summaryCollapsedOnly
                    >
                        <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-[var(--ag-colorText)]">
                                {template.trigger}
                            </span>
                            <span className="text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                                {template.triggerDescription}
                            </span>
                        </div>
                    </ConfigAccordionSection>

                    <ConfigAccordionSection
                        size="compact"
                        collapsible={false}
                        noDivider
                        icon={<PlugsConnected size={15} />}
                        title="Required to run"
                        status={allSet ? "complete" : "warning"}
                        summary={allSet ? "All set" : `${leftCount} left`}
                    >
                        <ModelRow model={template.model} />
                        {accounts.map((account) => (
                            <AccountRow
                                key={account.slug}
                                account={account}
                                onConnectedChange={handleConnectedChange}
                            />
                        ))}

                        <Typography.Text type="secondary" className="text-xs leading-snug">
                            Connect the required integrations to create this agent — you can manage
                            them anytime from the playground.
                        </Typography.Text>
                    </ConfigAccordionSection>
                </div>
            ) : null}
        </EnhancedDrawer>
    )
}

export default TemplateSetupDrawer
