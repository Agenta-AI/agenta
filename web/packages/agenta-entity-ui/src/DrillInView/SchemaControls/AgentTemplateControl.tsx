/**
 * AgentTemplateControl
 *
 * The agent playground's left config panel. It renders the whole agent config as a set
 * of collapsible accordion sections (Model & harness, Instructions, Tools, MCP servers,
 * Advanced), built on the reusable {@link ConfigAccordionSection} primitive so the same
 * pattern can roll out to other config surfaces.
 *
 * Dispatched from `x-ag-type: "agent-template"` / `x-ag-type-ref: "agent-template"` (see
 * SchemaPropertyRenderer). Its `value` IS the agent template (the `parameters.agent` object,
 * just as the prompt control's value is the prompt template): the portable definition
 * (instructions/llm/tools/mcps/skills) is FLAT on it, and the execution parts
 * (harness/runner/sandbox) are nested sub-objects. It reuses the existing schema controls rather
 * than inventing new ones: the model selector (GroupedChoiceControl), the agent tool picker
 * (AgentToolSelectorPopover + ToolItemControl), the MCP server editor (McpServerItemControl), enum
 * selects (harness, sandbox, permission policy), and a textarea (agents_md). The shape is the
 * `agent-template` catalog type generated from the SDK model (AgentTemplateSchema in
 * agenta.sdk.utils.types); the agent service ships a thin `x-ag-type-ref` the playground resolves
 * and reads back (services/oss/src/agent).
 *
 * Sections are schema-driven: each renders only when its field exists in the resolved
 * schema, so the panel tracks the backend contract instead of hard-coding fields.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {workflowBuildKitEnabledAtomFamily} from "@agenta/entities/workflow"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {
    Cpu,
    FileText,
    GraduationCap,
    Lightning,
    Plugs,
    Plus,
    SlidersHorizontal,
    Wrench,
} from "@phosphor-icons/react"
import {Button, Tabs, Tooltip, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtomValue, useStore} from "jotai"

import {useOptionalDrillIn} from "../components/MoleculeDrillInContext"

import {AddTextLink} from "./AddTextLink"
import {AgentIntegrationDrawer} from "./agentTemplate/AgentIntegrationDrawer"
import {countSummary} from "./agentTemplate/agentTemplateUtils"
import {AgentToolSelectorPopover} from "./agentTemplate/AgentToolSelectorPopover"
import {ConfigItemList} from "./agentTemplate/ConfigItemList"
import {ITEM_KINDS} from "./agentTemplate/itemKinds"
import {InstructionsFileRow} from "./agentTemplate/ItemRow"
import {ToolManagementList} from "./agentTemplate/ToolManagementList"
import {useAgentTools} from "./agentTemplate/useAgentTools"
import {useConfigItemDrawer} from "./agentTemplate/useConfigItemDrawer"
import {useModelHarness} from "./agentTemplate/useModelHarness"
import {agentTemplateLayoutAtom} from "./agentTemplateLayout"
import {ConfigItemDrawer} from "./ConfigItemDrawer"
import {InstructionsDrawer} from "./InstructionsDrawer"
import {JsonObjectEditor} from "./JsonObjectEditor"
import {SectionDrawer} from "./SectionDrawer"
import {type ToolObj} from "./toolUtils"
import {
    AddTriggerDropdown,
    TriggerManagementSection,
    useAgentTriggers,
} from "./TriggerManagementSection"
import {WorkflowReferenceSelector} from "./WorkflowReferenceSelector"

export interface AgentTemplateControlProps {
    schema?: SchemaProperty | null
    label?: string
    value?: Record<string, unknown> | null
    onChange: (value: Record<string, unknown>) => void
    description?: string
    withTooltip?: boolean
    disabled?: boolean
    className?: string
}

export function AgentTemplateControl({
    schema,
    value,
    onChange,
    withTooltip,
    disabled,
    className,
}: AgentTemplateControlProps) {
    const {gatewayTools, workflowReference} = useDrillInUI()
    const config = (value ?? {}) as Record<string, unknown>

    // Latest config, so an async write (e.g. after a schema lookup) doesn't clobber concurrent edits.
    const configRef = useRef(config)
    useEffect(() => {
        configRef.current = config
    }, [config])

    const [referenceSelectorOpen, setReferenceSelectorOpen] = useState(false)
    const [integrationDrawerOpen, setIntegrationDrawerOpen] = useState(false)
    // Preselected app for the integration drawer: set when a provider group's "Add {app} tool" opens
    // it (jump to that app's actions), cleared for the header + (open on the app grid).
    const [integrationDefaultKey, setIntegrationDefaultKey] = useState<string | undefined>(
        undefined,
    )
    const openIntegration = useCallback((integrationKey?: string) => {
        setIntegrationDefaultKey(integrationKey)
        setIntegrationDrawerOpen(true)
    }, [])
    // Shared draft-then-save drawer for tools, MCP servers, and skills (writes via ITEM_KINDS).
    const {
        editing,
        draft,
        setDraft,
        drawerView,
        setDrawerView,
        jsonInvalid,
        setJsonInvalid,
        openCreate,
        openEdit,
        closeEditor,
        commitDraft,
        removeItem,
        draftInvalid,
    } = useConfigItemDrawer({config, onChange})

    // Instructions file editor (a file list — one AGENTS.md today). Draft + Save like the item drawer.
    const [editingInstruction, setEditingInstruction] = useState<{filename: string} | null>(null)
    const [instructionDraft, setInstructionDraft] = useState("")
    const openInstruction = useCallback((filename: string, content: string) => {
        setInstructionDraft(content)
        setEditingInstruction({filename})
    }, [])

    // Section drawers (Model & harness, Advanced) use a SCOPED draft: edits are buffered locally and
    // relayed to the entity only on Save (Cancel discards; Save is gated on a real diff vs. the value
    // we opened with). The build-kit enable toggle lives OUTSIDE the config (a persisted atom), so it
    // is buffered alongside the config draft and committed to the atom on Save.
    const [openSection, setOpenSection] = useState<null | "model-harness" | "advanced">(null)
    const [draftConfig, setDraftConfig] = useState<Record<string, unknown> | null>(null)
    const [draftBuildKit, setDraftBuildKit] = useState<boolean | null>(null)
    const sectionBaseline = useRef<{config: Record<string, unknown>; buildKit: boolean} | null>(
        null,
    )
    const store = useStore()
    const revisionIdRef = useRef<string | null>(null)
    const applyDraftConfig = useCallback(
        (next: Record<string, unknown>) => setDraftConfig(next),
        [],
    )
    // Swallow writes from the draft hook while its drawer is closed (its body isn't rendered, so an
    // internal auto-correction effect must not leak into `draftConfig`). The live `mh` handles any
    // real auto-correction against the entity.
    const noopConfigChange = useCallback(() => {}, [])
    const openSectionDrawer = useCallback(
        (key: "model-harness" | "advanced") => {
            const snapshotConfig = (value ?? {}) as Record<string, unknown>
            const snapshotBuildKit = store.get(
                workflowBuildKitEnabledAtomFamily(revisionIdRef.current ?? ""),
            )
            setDraftConfig(snapshotConfig)
            setDraftBuildKit(snapshotBuildKit)
            sectionBaseline.current = {config: snapshotConfig, buildKit: snapshotBuildKit}
            setOpenSection(key)
        },
        [value, store],
    )
    const closeSectionDraft = useCallback(() => {
        setOpenSection(null)
        setDraftConfig(null)
        setDraftBuildKit(null)
        sectionBaseline.current = null
    }, [])
    // Cancel: nothing was written live, so just drop the draft.
    const cancelSection = closeSectionDraft
    const saveSection = useCallback(() => {
        if (draftConfig !== null) onChange(draftConfig)
        if (draftBuildKit !== null) {
            store.set(workflowBuildKitEnabledAtomFamily(revisionIdRef.current ?? ""), draftBuildKit)
        }
        closeSectionDraft()
    }, [draftConfig, draftBuildKit, onChange, store, closeSectionDraft])
    // Enable Save only when the draft actually differs from what we opened with (config or build-kit).
    const sectionDirty =
        openSection !== null &&
        sectionBaseline.current !== null &&
        (!deepEqual(draftConfig, sectionBaseline.current.config) ||
            draftBuildKit !== sectionBaseline.current.buildKit)

    // Layout (accordion / tabs / cards) is a global persisted preference; the panel only reads it.
    const layout = useAtomValue(agentTemplateLayoutAtom)

    // `config` IS the agent template (`parameters.agent`); `schema` is the `agent-template` type and
    // decides which sections exist. Portable fields (instructions / llm / tools / mcps / skills) are
    // FLAT; execution parts (harness / runner / sandbox) are nested sub-objects (see useModelHarness).
    const props = (schema?.properties ?? {}) as Record<string, SchemaProperty>

    // Set one flat field of the agent definition (instructions / tools / mcps / skills).
    const setAgentField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )

    // The open revision id (from drill-in context): harness-capability inspection (inside
    // useModelHarness) and bound-trigger scoping both key off it.
    const drillIn = useOptionalDrillIn<unknown>()
    const revisionId = drillIn?.entityId ?? null
    revisionIdRef.current = revisionId
    // Triggers bound to this agent (for the section count badge). The section body and the header
    // add-dropdown derive scoping from the same hook.
    const {count: triggerCount} = useAgentTriggers(revisionId)

    // Model & harness + Advanced own a lot of coupled, stateful logic (the model/connection state
    // feeds both sections), so they live in their own hook that returns the summaries + bodies.
    //
    // TWO instances, on purpose:
    //  - `mh` is bound to the LIVE entity — it drives the accordion header summaries + the inline
    //    tabs bodies. Keeping it live means a section header NEVER reflects the drawer's unsaved draft
    //    (the reported bug: editing in the open drawer updated the background summary).
    //  - `mhDraft` is bound to the DRAFT (config + build-kit) — it drives the OPEN section drawer's
    //    body, so its forms edit the buffer and Save relays it to the entity/atom. When no drawer is
    //    open its `onChange` is a no-op (and its body isn't rendered), so the extra hook is inert.
    const mh = useModelHarness({schema, config, onChange, disabled, withTooltip, revisionId})
    const mhDraft = useModelHarness({
        schema,
        config: draftConfig ?? config,
        onChange: openSection !== null ? applyDraftConfig : noopConfigChange,
        disabled,
        withTooltip,
        revisionId,
        buildKitEnabledOverride:
            draftBuildKit !== null ? {value: draftBuildKit, onChange: setDraftBuildKit} : undefined,
        // "Current" marks the SAVED harness (from the live entity), not the draft pick.
        savedHarnessValue:
            ((config.harness as Record<string, unknown> | undefined)?.kind as string | undefined) ??
            null,
    })

    // Tool add/remove (inline function, builtin, gateway, workflow reference) lives in its own hook.
    const {
        tools,
        handleAddTool,
        handleAddWorkflowReference,
        handleRemoveToolByName,
        handleRemoveBuiltinTool,
        selectedToolNames,
        referenceableWorkflows,
    } = useAgentTools({config, onChange, configRef, openCreate, workflowReference})

    // MCP servers: a flat array of McpServer shapes (stdio command/args/env or remote url + secrets).
    const mcpServers = useMemo(
        () => (Array.isArray(config.mcps) ? (config.mcps as unknown[]) : []),
        [config.mcps],
    )
    const handleAddMcpServer = useCallback(
        () => openCreate("mcp", ITEM_KINDS.mcp.createSeed(), "form"),
        [openCreate],
    )

    // Skills: a flat array of inline SKILL.md packages or `@ag.embed` references the backend inlines.
    const skills = useMemo(
        () => (Array.isArray(config.skills) ? (config.skills as unknown[]) : []),
        [config.skills],
    )
    const handleAddSkill = useCallback(
        () => openCreate("skill", ITEM_KINDS.skill.createSeed(), "form"),
        [openCreate],
    )

    // ``instructions.agents_md`` is the one instruction document (flat on the template).
    const instructions =
        config.instructions && typeof config.instructions === "object"
            ? (config.instructions as Record<string, unknown>)
            : {}
    const agentsMd = (instructions.agents_md as string | null | undefined) ?? null

    const hasInstructions = Boolean(props.instructions)
    const hasTools = Boolean(props.tools)
    const hasMcp = Boolean(props.mcps)
    const hasSkills = Boolean(props.skills)

    // Per-field section headers read their label from the template schema (`props.<field>.title`),
    // so a field rename propagates without editing this file; the literal is a fallback. Composite
    // sections (Model & harness, Advanced) and Triggers keep their FE labels, and icons aren't in
    // the schema.
    //
    // Guard: schema-gen emits the wrapper class name as `title` for single nested-model fields
    // (e.g. `instructions` -> "_InstructionsSchema"), so reject leading-underscore titles and fall
    // back to the literal. List fields (tools/mcps/skills) carry real titles and pass through.
    const fieldTitle = useCallback(
        (field: string, fallback: string): string => {
            const t = (props[field] as {title?: unknown} | undefined)?.title
            return typeof t === "string" && t.trim() && !t.startsWith("_") ? t : fallback
        },
        [props],
    )

    // Shared props for the tool picker, so the in-body popover and the header quick-add trigger
    // drive the same add flow.
    const toolSelectorProps = {
        onAddTool: handleAddTool,
        onRemoveTool: handleRemoveToolByName,
        onRemoveBuiltinTool: handleRemoveBuiltinTool,
        selectedToolNames,
        selectedTools: tools as ToolObj[],
        existingToolCount: tools.length,
        gatewayTools,
        onReferenceWorkflow: workflowReference?.enabled
            ? () => setReferenceSelectorOpen(true)
            : undefined,
        // Route the integration row to the agent-scoped drawer instead of the shared global catalog.
        onOpenIntegration: gatewayTools?.enabled ? openIntegration : undefined,
    }

    // Compact "+" for a section header's `extra` slot (stops propagation, so it never toggles open).
    const headerAddButton = (label: string, onClick: () => void) => (
        <Tooltip title={label}>
            <Button type="text" icon={<Plus size={16} />} onClick={onClick} aria-label={label} />
        </Tooltip>
    )

    // Each config section as a descriptor, so it can be rendered in any layout (accordion /
    // tabs / cards) without duplicating the content. Schema-gated, like before.
    const sections = [
        mh.hasModelOrHarness && {
            key: "model-harness",
            icon: <Cpu size={16} />,
            title: "Model & harness",
            summary: mh.modelSummary,
            defaultOpen: true,
            onOpen: () => openSectionDrawer("model-harness"),
            content: mh.modelHarnessDrawerBody,
            inlineContent: mh.modelHarnessInline,
        },
        hasInstructions && {
            key: "instructions",
            icon: <FileText size={16} />,
            title: fieldTitle("instructions", "Instructions"),
            summary: countSummary(1, "file"),
            // The + is inert until the backend stores multiple instruction files; the section is
            // already a list so it lights up with no rework when that lands.
            extra: !disabled ? (
                <Tooltip title="Multiple instruction files coming soon">
                    <span>
                        <Button
                            type="text"
                            icon={<Plus size={16} />}
                            disabled
                            aria-label="Add instruction file"
                        />
                    </span>
                </Tooltip>
            ) : undefined,
            defaultOpen: true,
            content: (
                <div className="flex flex-col gap-2">
                    <InstructionsFileRow
                        filename="AGENTS.md"
                        content={agentsMd ?? ""}
                        onOpen={() => openInstruction("AGENTS.md", agentsMd ?? "")}
                    />
                </div>
            ),
        },
        hasTools && {
            key: "tools",
            icon: <Wrench size={16} />,
            title: fieldTitle("tools", "Tools"),
            summary: countSummary(tools.length, "tool"),
            extra: !disabled ? (
                <AgentToolSelectorPopover
                    {...toolSelectorProps}
                    trigger={
                        <Tooltip title="Add tool">
                            <Button
                                type="text"
                                icon={<Plus size={16} />}
                                disabled={disabled}
                                aria-label="Add tool"
                            />
                        </Tooltip>
                    }
                />
            ) : undefined,
            defaultOpen: true,
            content: (
                <ToolManagementList
                    tools={tools}
                    entityId={revisionId}
                    openEdit={openEdit}
                    removeItem={removeItem}
                    closeEditor={closeEditor}
                    disabled={disabled}
                    onOpenIntegration={gatewayTools?.enabled ? openIntegration : undefined}
                    // The empty-state add is the same popover as the header +.
                    emptyAdd={
                        <AgentToolSelectorPopover
                            {...toolSelectorProps}
                            trigger={<AddTextLink label="add a tool" />}
                        />
                    }
                />
            ),
        },
        hasMcp && {
            key: "mcp",
            icon: <Plugs size={16} />,
            title: fieldTitle("mcps", "MCP servers"),
            summary: countSummary(mcpServers.length, "server"),
            extra: !disabled ? headerAddButton("Add MCP server", handleAddMcpServer) : undefined,
            defaultOpen: mcpServers.length > 0,
            content: (
                <ConfigItemList
                    kind="mcp"
                    items={mcpServers}
                    openEdit={openEdit}
                    removeItem={removeItem}
                    closeEditor={closeEditor}
                    disabled={disabled}
                    emptyAdd={<AddTextLink label="add a server" onClick={handleAddMcpServer} />}
                />
            ),
        },
        hasSkills && {
            key: "skills",
            icon: <GraduationCap size={16} />,
            title: fieldTitle("skills", "Skills"),
            summary: countSummary(skills.length, "skill"),
            extra: !disabled ? headerAddButton("Add skill", handleAddSkill) : undefined,
            defaultOpen: skills.length > 0,
            content: (
                <ConfigItemList
                    kind="skill"
                    items={skills}
                    openEdit={openEdit}
                    removeItem={removeItem}
                    closeEditor={closeEditor}
                    disabled={disabled}
                    emptyAdd={<AddTextLink label="add a skill" onClick={handleAddSkill} />}
                />
            ),
        },
        {
            key: "triggers",
            icon: <Lightning size={16} />,
            title: "Triggers",
            summary: countSummary(triggerCount, "trigger"),
            extra: !disabled ? <AddTriggerDropdown entityId={revisionId} /> : undefined,
            defaultOpen: triggerCount > 0,
            content: <TriggerManagementSection entityId={revisionId} disabled={disabled} />,
        },
        mh.hasAdvanced && {
            key: "advanced",
            icon: <SlidersHorizontal size={16} />,
            title: "Advanced",
            defaultOpen: false,
            summary: mh.advancedSummary,
            onOpen: () => openSectionDrawer("advanced"),
            content: mh.advancedDrawerBody,
            inlineContent: mh.advancedInline,
        },
    ].filter(Boolean) as {
        key: string
        icon: React.ReactNode
        title: React.ReactNode
        summary?: React.ReactNode
        extra?: React.ReactNode
        defaultOpen?: boolean
        onOpen?: () => void
        content: React.ReactNode
        // Trimmed single-column body for the tabs layout (drawer sections only); falls back to
        // `content` when a section has no separate inline form.
        inlineContent?: React.ReactNode
    }[]

    return (
        <div className={cn("flex flex-col", className)}>
            {sections.length === 0 ? (
                <Typography.Text type="secondary" className="text-xs">
                    No agent configuration fields are available for this schema.
                </Typography.Text>
            ) : layout === "tabs" ? (
                // Tabs renders each section's body inline (no drawer), so edits are live. Drawer
                // sections supply a trimmed `inlineContent` so the tab shows just their controls.
                <Tabs
                    items={sections.map((s) => ({
                        key: s.key,
                        label: (
                            <span className="inline-flex items-center gap-1.5">
                                {s.icon}
                                {s.title}
                            </span>
                        ),
                        children: (
                            // Render `extra` (the add-action) here too, else tab users can't add
                            // items. Body is the trimmed `inlineContent` or `content`.
                            <div className="flex flex-col gap-3 pt-1">
                                {s.extra ? <div className="flex justify-end">{s.extra}</div> : null}
                                {s.inlineContent ?? s.content}
                            </div>
                        ),
                    }))}
                />
            ) : layout === "cards" ? (
                <div className="flex flex-col gap-3 pt-1">
                    {sections.map((s) => (
                        <ConfigAccordionSection
                            key={s.key}
                            icon={s.icon}
                            title={s.title}
                            summary={s.summary}
                            extra={s.extra}
                            onOpen={s.onOpen}
                            collapsible={false}
                            noDivider
                            className="rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3"
                        >
                            {s.content}
                        </ConfigAccordionSection>
                    ))}
                </div>
            ) : (
                sections.map((s, index) => (
                    <ConfigAccordionSection
                        key={s.key}
                        icon={s.icon}
                        title={s.title}
                        summary={s.summary}
                        extra={s.extra}
                        onOpen={s.onOpen}
                        defaultOpen={s.defaultOpen}
                        noDivider={index === sections.length - 1}
                    >
                        {s.content}
                    </ConfigAccordionSection>
                ))
            )}

            {editing
                ? (() => {
                      // One drawer for all three kinds — the per-kind icon/title/form/view rules
                      // come from the ITEM_KINDS registry (replaces three near-identical blocks).
                      const def = ITEM_KINDS[editing.kind]
                      const desc = def.describe(draft)
                      const readOnly = disabled || def.isReadOnly(draft)
                      const Form = def.FormView
                      const itemKey = `${editing.kind}-${editing.mode}-${editing.index}`
                      return (
                          <ConfigItemDrawer
                              open
                              mode={editing.mode}
                              icon={def.icon}
                              title={def.drawerTitle(draft)}
                              badge={{text: desc.typeLabel, color: desc.typeColor}}
                              subtitle={desc.subtitle}
                              footerNote="Changes apply to this agent configuration"
                              width={def.drawerWidth}
                              contentFlush={def.formFlush}
                              view={drawerView}
                              onViewChange={setDrawerView}
                              onCancel={closeEditor}
                              onSave={commitDraft}
                              saveDisabled={draftInvalid || (drawerView === "json" && jsonInvalid)}
                              jsonOnly={def.jsonOnly(draft)}
                              disabled={readOnly}
                              form={
                                  <Form
                                      key={`form-${itemKey}`}
                                      value={draft}
                                      onChange={(v) => setDraft(v)}
                                      disabled={readOnly}
                                  />
                              }
                              json={
                                  <JsonObjectEditor
                                      key={`json-${itemKey}`}
                                      value={draft}
                                      onChange={(v) => setDraft(v as Record<string, unknown>)}
                                      onValidityChange={(valid) => setJsonInvalid(!valid)}
                                      disabled={readOnly}
                                  />
                              }
                          />
                      )
                  })()
                : null}

            {editingInstruction && (
                <InstructionsDrawer
                    open
                    filename={editingInstruction.filename}
                    value={instructionDraft}
                    onChange={setInstructionDraft}
                    onCancel={() => setEditingInstruction(null)}
                    onSave={() => {
                        setAgentField("instructions", {
                            ...instructions,
                            agents_md: instructionDraft,
                        })
                        setEditingInstruction(null)
                    }}
                    disabled={disabled}
                />
            )}

            <SectionDrawer
                open={openSection === "model-harness"}
                title="Model & harness"
                icon={<Cpu size={16} />}
                onCancel={cancelSection}
                onSave={saveSection}
                disabled={disabled || !sectionDirty}
                width={mhDraft.modelHarnessDrawerWidth}
            >
                {mhDraft.modelHarnessDrawerBody}
            </SectionDrawer>

            <SectionDrawer
                open={openSection === "advanced"}
                title="Advanced"
                icon={<SlidersHorizontal size={16} />}
                onCancel={cancelSection}
                onSave={saveSection}
                disabled={disabled || !sectionDirty}
                width={880}
            >
                {mhDraft.advancedDrawerBody}
            </SectionDrawer>

            {workflowReference?.enabled && (
                <WorkflowReferenceSelector
                    open={referenceSelectorOpen}
                    onClose={() => setReferenceSelectorOpen(false)}
                    workflows={referenceableWorkflows}
                    bridge={workflowReference}
                    onSelect={(payload) => {
                        void handleAddWorkflowReference(payload)
                        setReferenceSelectorOpen(false)
                    }}
                />
            )}

            {gatewayTools?.enabled && (
                <AgentIntegrationDrawer
                    open={integrationDrawerOpen}
                    onClose={() => {
                        setIntegrationDrawerOpen(false)
                        setIntegrationDefaultKey(undefined)
                    }}
                    onAddTool={handleAddTool}
                    onRemoveTool={handleRemoveToolByName}
                    selectedToolNames={selectedToolNames}
                    defaultIntegrationKey={integrationDefaultKey}
                />
            )}
        </div>
    )
}
