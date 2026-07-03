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
import {workflowBuildKitEnabledAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    agentItemIdentity,
    classifyAgentChanges,
    stableStringify,
} from "@agenta/entities/workflow/commitDiff"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {ConfigAccordionSection, sectionIndicatorColor} from "@agenta/ui/components/presentational"
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
import {ITEM_KINDS, type ItemKind} from "./agentTemplate/itemKinds"
import {InstructionsFileRow, type ItemRowStatus} from "./agentTemplate/ItemRow"
import {ToolManagementList} from "./agentTemplate/ToolManagementList"
import {useAgentTools} from "./agentTemplate/useAgentTools"
import {useConfigItemDrawer} from "./agentTemplate/useConfigItemDrawer"
import {useModelHarness} from "./agentTemplate/useModelHarness"
import {agentTemplateLayoutAtom} from "./agentTemplateLayout"
import {ConfigItemDrawer} from "./ConfigItemDrawer"
import {modelIdFromConfig} from "./connectionUtils"
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

// Tooltip copy for the config-panel draft/validation indicators.
const INVALID_ITEM_TIP: Record<ItemKind, string> = {
    tool: "This tool is missing its name.",
    mcp: "This server is missing a required field (name, command, or URL).",
    skill: "This skill is missing its name.",
}
const DRAFT_TIP: Record<string, string> = {
    "model-harness": "Unsaved model or harness changes.",
    instructions: "Unsaved instruction changes.",
    tools: "Unsaved tool changes.",
    mcp: "Unsaved MCP server changes.",
    skills: "Unsaved skill changes.",
    advanced: "Unsaved advanced-setting changes.",
}

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

    // ── Draft + validation indicators ─────────────────────────────────────────
    // Committed (server) template to diff the live config against. Null for a never-saved
    // draft — then only validation (not draft) indicators show.
    const committedConfig = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.serverConfiguration(revisionId ?? ""),
            [revisionId],
        ),
    ) as Record<string, unknown> | null
    const committed = useMemo(() => {
        if (!committedConfig) return null
        const agent = committedConfig.agent
        const template =
            agent && typeof agent === "object" && !Array.isArray(agent) ? agent : committedConfig
        // Strip agenta metadata so it compares like-for-like against the live value.
        return stripAgentaMetadataDeep(template) as Record<string, unknown>
    }, [committedConfig])

    // Header rollup: which sections changed vs the commit. Reuses the commit-diff classifier so
    // the grouping matches (model+harness together; advanced = runner/sandbox/params).
    const draftSectionKeys = useMemo(() => {
        const keys = new Set<string>()
        if (!committed) return keys
        const map: Record<string, string> = {
            model: "model-harness",
            instructions: "instructions",
            tools: "tools",
            mcps: "mcp",
            skills: "skills",
            params: "advanced",
        }
        const local = stripAgentaMetadataDeep(config) as Record<string, unknown>
        for (const s of classifyAgentChanges(local, committed)) {
            const k = map[s.id]
            if (k) keys.add(k)
        }
        return keys
    }, [config, committed])

    // Per-item draft: canonical identity → stable-stringified committed value, so a row reads as
    // "new" (identity absent from the baseline) or "edited" (present but the value differs). The
    // identity is collision-free (see agentItemIdentity) so id-less builtin/reference tools and
    // unnamed items don't collapse onto one map key.
    const baseMaps = useMemo(() => {
        const build = (list: unknown, kind: ItemKind) =>
            new Map(
                (Array.isArray(list) ? list : []).map(
                    (e, i) => [agentItemIdentity(kind, e, i), stableStringify(e)] as const,
                ),
            )
        return {
            tool: build(committed?.tools, "tool"),
            mcp: build(committed?.mcps, "mcp"),
            skill: build(committed?.skills, "skill"),
        }
    }, [committed])

    const statusForKind = useCallback(
        (kind: ItemKind) =>
            (item: unknown, index: number): ItemRowStatus | undefined => {
                if (ITEM_KINDS[kind].draftInvalid(item as Record<string, unknown>)) {
                    return {tone: "invalid", label: "Incomplete", tooltip: INVALID_ITEM_TIP[kind]}
                }
                if (!committed) return undefined
                const prev = baseMaps[kind].get(agentItemIdentity(kind, item, index))
                if (prev === undefined)
                    return {tone: "new", label: "New", tooltip: "Added since the last commit."}
                if (prev !== stableStringify(stripAgentaMetadataDeep(item)))
                    return {tone: "edited", label: "Edited", tooltip: "Edited — not yet committed."}
                return undefined
            },
        [committed, baseMaps],
    )
    const toolStatusFor = useMemo(() => statusForKind("tool"), [statusForKind])
    const mcpStatusFor = useMemo(() => statusForKind("mcp"), [statusForKind])
    const skillStatusFor = useMemo(() => statusForKind("skill"), [statusForKind])

    // Section headers: a blocking problem (invalid) outranks unsaved edits (draft).
    const sectionInvalidTip = (key: string): string | null => {
        if (key === "model-harness")
            return mh.hasModelOrHarness && !modelIdFromConfig(config.llm)
                ? "No model is selected."
                : null
        if (key === "tools")
            return tools.some((t) => ITEM_KINDS.tool.draftInvalid(t as Record<string, unknown>))
                ? "A tool is missing its name."
                : null
        if (key === "mcp")
            return mcpServers.some((m) => ITEM_KINDS.mcp.draftInvalid(m as Record<string, unknown>))
                ? "An MCP server is missing a required field."
                : null
        if (key === "skills")
            return skills.some((s) => ITEM_KINDS.skill.draftInvalid(s as Record<string, unknown>))
                ? "A skill is missing its name."
                : null
        return null
    }
    const headerIndicator = (
        key: string,
    ): {tone: "draft" | "invalid" | "incomplete"; tooltip?: string} | undefined => {
        const invalid = sectionInvalidTip(key)
        if (invalid) return {tone: "invalid", tooltip: invalid}
        if (draftSectionKeys.has(key))
            return {
                tone: "draft",
                tooltip: DRAFT_TIP[key] ?? "Unsaved changes — not yet committed.",
            }
        return undefined
    }
    const instructionsStatus: ItemRowStatus | undefined = draftSectionKeys.has("instructions")
        ? {tone: "edited", label: "Edited", tooltip: "Edited — not yet committed."}
        : undefined

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
            indicator: headerIndicator("model-harness"),
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
            indicator: headerIndicator("instructions"),
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
                        status={instructionsStatus}
                    />
                </div>
            ),
        },
        hasTools && {
            key: "tools",
            icon: <Wrench size={16} />,
            title: fieldTitle("tools", "Tools"),
            summary: countSummary(tools.length, "tool"),
            indicator: headerIndicator("tools"),
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
                    statusFor={toolStatusFor}
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
            indicator: headerIndicator("mcp"),
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
                    statusFor={mcpStatusFor}
                    emptyAdd={<AddTextLink label="add a server" onClick={handleAddMcpServer} />}
                />
            ),
        },
        hasSkills && {
            key: "skills",
            icon: <GraduationCap size={16} />,
            title: fieldTitle("skills", "Skills"),
            summary: countSummary(skills.length, "skill"),
            indicator: headerIndicator("skills"),
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
                    statusFor={skillStatusFor}
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
            indicator: headerIndicator("advanced"),
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
        indicator?: {tone: "draft" | "invalid" | "incomplete"; tooltip?: string}
        defaultOpen?: boolean
        onOpen?: () => void
        content: React.ReactNode
        // Trimmed single-column body for the tabs layout (drawer sections only); falls back to
        // `content` when a section has no separate inline form.
        inlineContent?: React.ReactNode
    }[]

    // Each config section is a contained card on the raised Config panel — the surface tokens give
    // it depth against the panel (see theme-variables.css "Agent Playground surface ladder").
    const sectionCardClass = "ag-surface-card rounded-[11px] px-4"

    // Keep the item + instruction drawers MOUNTED while they animate closed. Their editing state
    // goes null on close; retaining the last value and driving `open` off the live state lets the
    // exit transition play (an unmount-on-close drawer just vanishes). Matches the SectionDrawers.
    const lastEditingRef = useRef(editing)
    if (editing) lastEditingRef.current = editing
    const shownEditing = editing ?? lastEditingRef.current
    const lastInstructionRef = useRef(editingInstruction)
    if (editingInstruction) lastInstructionRef.current = editingInstruction
    const shownInstruction = editingInstruction ?? lastInstructionRef.current

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
                                <Tooltip title={s.indicator?.tooltip}>
                                    <span
                                        className="relative inline-flex items-center"
                                        style={
                                            s.indicator
                                                ? {
                                                      color: `color-mix(in srgb, ${sectionIndicatorColor(s.indicator.tone)} 45%, var(--ag-colorTextTertiary))`,
                                                  }
                                                : undefined
                                        }
                                    >
                                        {s.icon}
                                        {s.indicator ? (
                                            <span
                                                className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full"
                                                style={{
                                                    background: sectionIndicatorColor(
                                                        s.indicator.tone,
                                                    ),
                                                }}
                                            />
                                        ) : null}
                                    </span>
                                </Tooltip>
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
                            indicator={s.indicator}
                            onOpen={s.onOpen}
                            collapsible={false}
                            noDivider
                            className={sectionCardClass}
                        >
                            {s.content}
                        </ConfigAccordionSection>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col gap-3 pt-1">
                    {sections.map((s) => (
                        <ConfigAccordionSection
                            key={s.key}
                            icon={s.icon}
                            title={s.title}
                            summary={s.summary}
                            extra={s.extra}
                            indicator={s.indicator}
                            onOpen={s.onOpen}
                            defaultOpen={s.defaultOpen}
                            noDivider
                            className={sectionCardClass}
                        >
                            {s.content}
                        </ConfigAccordionSection>
                    ))}
                </div>
            )}

            {shownEditing
                ? (() => {
                      // One drawer for all three kinds — the per-kind icon/title/form/view rules
                      // come from the ITEM_KINDS registry (replaces three near-identical blocks).
                      const def = ITEM_KINDS[shownEditing.kind]
                      const desc = def.describe(draft)
                      const readOnly = disabled || def.isReadOnly(draft)
                      const Form = def.FormView
                      const itemKey = `${shownEditing.kind}-${shownEditing.mode}-${shownEditing.index}`
                      return (
                          <ConfigItemDrawer
                              open={!!editing}
                              mode={shownEditing.mode}
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

            {shownInstruction && (
                <InstructionsDrawer
                    open={!!editingInstruction}
                    filename={shownInstruction.filename}
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
