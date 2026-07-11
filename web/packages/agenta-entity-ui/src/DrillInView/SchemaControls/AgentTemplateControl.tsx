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
import {Fragment, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {toolActionAvailabilityKey, useToolActionAvailability} from "@agenta/entities/gatewayTool"
import type {SchemaProperty} from "@agenta/entities/shared"
import {
    agentCreationPrefsAtom,
    workflowBuildKitEnabledAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {
    agentItemIdentity,
    classifyAgentChanges,
    stableStringify,
} from "@agenta/entities/workflow/commitDiff"
import {agentSelfCommitSignalAtom, openAgentConfigSectionAtom} from "@agenta/shared/state"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {
    ConfigAccordionSection,
    sectionIndicatorColor,
    type SectionIndicatorTone,
} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {
    Cpu,
    FileText,
    GraduationCap,
    HardDrives,
    Lightning,
    Plugs,
    Plus,
    SlidersHorizontal,
    Wrench,
} from "@phosphor-icons/react"
import {Button, Tabs, Tooltip, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue, useStore} from "jotai"

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
import {connectionFromConfig, modelIdFromConfig} from "./connectionUtils"
import {InstructionsDrawer} from "./InstructionsDrawer"
import {JsonObjectEditor} from "./JsonObjectEditor"
import {SectionDrawer} from "./SectionDrawer"
import {parseGatewayTool, type ParsedGatewayTool, type ToolObj} from "./toolUtils"
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

// Draft body for the Model & harness / Advanced section drawers. Isolated into its own component so
// `useModelHarness` (harness-catalog + vault-secrets + build-kit-overlay subscriptions) runs ONLY
// while a section drawer is open — `SectionDrawer` uses `destroyOnClose`, so this mounts on open and
// unmounts on close. Previously a second `useModelHarness` ran in the always-mounted parent,
// subscribing on every agent-config render even with both drawers shut.
const ModelHarnessSectionDrawerBody = ({
    section,
    ...params
}: {section: "model-harness" | "advanced"} & Parameters<typeof useModelHarness>[0]) => {
    const mh = useModelHarness(params)
    return <>{section === "advanced" ? mh.advancedDrawerBody : mh.modelHarnessDrawerBody}</>
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
    // Single source of truth for "the currently open section has unsaved edits" — shared by the
    // open-a-new-section guard below and the Save-button gate (`sectionDirty`) so they can't drift.
    const isCurrentSectionDirty = useCallback(
        () =>
            openSection !== null &&
            sectionBaseline.current !== null &&
            (!deepEqual(draftConfig, sectionBaseline.current.config) ||
                draftBuildKit !== sectionBaseline.current.buildKit),
        [openSection, draftConfig, draftBuildKit],
    )
    const openSectionDrawer = useCallback(
        (key: "model-harness" | "advanced") => {
            // Same section already open: never re-snapshot over a live draft.
            if (openSection === key) return
            // Another section is open with unsaved edits: drop the request rather than clobber it.
            if (isCurrentSectionDirty()) return
            const snapshotConfig = (value ?? {}) as Record<string, unknown>
            const snapshotBuildKit = store.get(
                workflowBuildKitEnabledAtomFamily(revisionIdRef.current ?? ""),
            )
            setDraftConfig(snapshotConfig)
            setDraftBuildKit(snapshotBuildKit)
            sectionBaseline.current = {config: snapshotConfig, buildKit: snapshotBuildKit}
            setOpenSection(key)
        },
        [value, store, openSection, isCurrentSectionDirty],
    )
    const closeSectionDraft = useCallback(() => {
        setOpenSection(null)
        setDraftConfig(null)
        setDraftBuildKit(null)
        sectionBaseline.current = null
    }, [])

    // Remote request to open a section drawer (e.g. the chat's connect-a-model banner → Model & harness).
    const [openSectionRequest, setOpenSectionRequest] = useAtom(openAgentConfigSectionAtom)
    useEffect(() => {
        if (!openSectionRequest) return
        // Always clears the request, even when openSectionDrawer no-ops on a dirty open section —
        // the request is intentionally dropped rather than queued.
        openSectionDrawer(openSectionRequest)
        setOpenSectionRequest(null)
    }, [openSectionRequest, openSectionDrawer, setOpenSectionRequest])
    // Cancel: nothing was written live, so just drop the draft.
    const cancelSection = closeSectionDraft
    const saveSection = useCallback(() => {
        if (draftConfig !== null) {
            onChange(draftConfig)
            // Remember the harness/model/connection pick for future agent creations — only on an
            // explicit Model & harness save, not on every keystroke or the Advanced section.
            if (openSection === "model-harness") {
                const harness = draftConfig.harness
                const harnessKind =
                    harness && typeof harness === "object" && !Array.isArray(harness)
                        ? (harness as Record<string, unknown>).kind
                        : undefined
                const modelId = modelIdFromConfig(draftConfig.llm)
                const connection = connectionFromConfig(draftConfig.llm)
                store.set(agentCreationPrefsAtom, (prev) => ({
                    version: 1,
                    harness: typeof harnessKind === "string" ? harnessKind : prev.harness,
                    model: modelId ?? prev.model,
                    provider: connection.provider ?? prev.provider,
                    connectionMode: connection.mode ?? prev.connectionMode,
                }))
            }
        }
        if (draftBuildKit !== null) {
            store.set(workflowBuildKitEnabledAtomFamily(revisionIdRef.current ?? ""), draftBuildKit)
        }
        closeSectionDraft()
    }, [draftConfig, draftBuildKit, openSection, onChange, store, closeSectionDraft])
    // Enable Save only when the draft actually differs from what we opened with (config or build-kit).
    const sectionDirty = isCurrentSectionDirty()

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

    // ── Agent self-commit: surface WHAT the agent just changed ──────────────────────────
    // The chat raises the signal (with the outgoing revision's parameters) when the agent
    // commits itself and the playground switches in place. Once this control renders the
    // NEW revision, diff the configs per section and mark the changed ones. The computed
    // set is FROZEN on first non-empty result so the user's own subsequent edits don't
    // drift into the "agent changed this" indication. Dismiss (or the next commit) clears.
    const commitSignal = useAtomValue(agentSelfCommitSignalAtom)
    const frozenAgentDiffRef = useRef<{signalAt: number; keys: Set<string>} | null>(null)
    const agentChangedKeys = useMemo(() => {
        if (!commitSignal || !revisionId || commitSignal.revisionId !== revisionId) return null
        if (frozenAgentDiffRef.current?.signalAt === commitSignal.at) {
            return frozenAgentDiffRef.current.keys
        }
        try {
            const sectionIdToKey: Record<string, string> = {
                model: "model-harness",
                instructions: "instructions",
                tools: "tools",
                mcps: "mcp",
                skills: "skills",
                params: "advanced",
            }
            const changed = classifyAgentChanges(commitSignal.prevParameters, {agent: value})
            const keys = new Set(
                changed.map((s) => sectionIdToKey[s.id]).filter((k): k is string => Boolean(k)),
            )
            if (keys.size === 0) return null
            frozenAgentDiffRef.current = {signalAt: commitSignal.at, keys}
            return keys
        } catch {
            return null
        }
    }, [commitSignal, revisionId, value])
    const agentChangeIndicator = useCallback(
        (sectionKey: string) => {
            if (!agentChangedKeys?.has(sectionKey)) return undefined
            const raw = commitSignal?.version ? String(commitSignal.version) : null
            const version = raw ? (raw.startsWith("v") ? raw : `v${raw}`) : null
            return {
                tone: "agent" as const,
                tooltip: `Updated by the agent${version ? ` in ${version}` : ""}`,
            }
        },
        [agentChangedKeys, commitSignal?.version],
    )
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
    //  - The DRAFT instance (config + build-kit buffer) that drives the OPEN section drawer's body
    //    now lives inside `ModelHarnessSectionDrawerBody`, mounted only while the drawer is open, so
    //    its harness/vault/overlay subscriptions don't run in the background.
    const mh = useModelHarness({schema, config, onChange, disabled, withTooltip, revisionId})
    const draftBuildKitOverride = useMemo(
        () =>
            draftBuildKit !== null ? {value: draftBuildKit, onChange: setDraftBuildKit} : undefined,
        [draftBuildKit],
    )
    // "Current" marks the SAVED harness (from the live entity), not the draft pick.
    const savedHarnessValue =
        ((config.harness as Record<string, unknown> | undefined)?.kind as string | undefined) ??
        null

    // Tool add/remove (inline function, builtin, gateway, workflow reference) lives in its own hook.
    const {
        tools,
        handleAddTool,
        handleAddWorkflowReference,
        handleRemoveToolByName,
        handleRemoveBuiltinTool,
        selectedToolNames,
        selectedGatewayIds,
        removeGatewayToolByIdentity,
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

    // Match unchanged values before identity so deleting an earlier item cannot make positional
    // identities mark every surviving row as edited. Identity then distinguishes new from edited.
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
                const currentValue = stableStringify(stripAgentaMetadataDeep(item))
                if ([...baseMaps[kind].values()].includes(currentValue)) return undefined
                const prev = baseMaps[kind].get(agentItemIdentity(kind, item, index))
                if (prev === undefined)
                    return {tone: "new", label: "New", tooltip: "Added since the last commit."}
                return {tone: "edited", label: "Edited", tooltip: "Edited — not yet committed."}
            },
        [committed, baseMaps],
    )

    // ── Connected-app tool resolution ─────────────────────────────────────────
    // Mirrors the tool drawer's fail-safe (a canonical gateway tool whose catalog action 404s
    // shows the raw-JSON warning) so the row is marked BEFORE the drawer is opened. The probe
    // reuses the drawer's query family (low-priority fetch, 5-min cache), and the connection
    // registry is already loaded by the provider — no extra render-critical requests.
    const gatewayToolViews = useMemo(() => {
        const views = new Map<number, ParsedGatewayTool>()
        tools.forEach((item, index) => {
            const gw = parseGatewayTool(item)
            if (gw) views.set(index, gw)
        })
        return views
    }, [tools])
    const actionProbePairs = useMemo(
        () =>
            gatewayTools?.enabled
                ? [...gatewayToolViews.values()]
                      .filter((v) => v.encoding === "canonical")
                      .map((v) => ({integrationKey: v.integration, actionKey: v.action}))
                : [],
        [gatewayToolViews, gatewayTools?.enabled],
    )
    const actionAvailability = useToolActionAvailability(actionProbePairs)
    // Connection lookup by slug and id (tools persist the slug; index both to be safe).
    // Null while loading or after a failed fetch — an empty list must not read as "all removed".
    const connectionLookup = useMemo(() => {
        if (!gatewayTools?.enabled || gatewayTools.connectionsLoading) return null
        if (gatewayTools.connectionsErrored) return null
        const lookup = new Map<string, (typeof gatewayTools.connections)[number]>()
        for (const c of gatewayTools.connections) {
            lookup.set(c.slug, c)
            lookup.set(c.id, c)
        }
        return lookup
    }, [gatewayTools])
    const toolResolutionStatus = useCallback(
        (index: number): ItemRowStatus | undefined => {
            const gw = gatewayToolViews.get(index)
            if (!gw) return undefined
            if (
                gw.encoding === "canonical" &&
                actionAvailability[toolActionAvailabilityKey(gw.integration, gw.action)] ===
                    "missing"
            ) {
                return {
                    tone: "invalid",
                    label: "Unresolved",
                    tooltip:
                        "Couldn't resolve this tool — the action may have been renamed or removed. Open it to inspect the raw definition.",
                }
            }
            // Null while connections are still loading: never flash "Unresolved" on a slow load.
            if (!connectionLookup) return undefined
            const connection = connectionLookup.get(gw.connection)
            if (!connection) {
                return {
                    tone: "invalid",
                    label: "Unresolved",
                    tooltip: `The "${gw.connection}" connection no longer exists in this project. Reconnect the app or remove the tool.`,
                }
            }
            if (connection.flags?.is_valid === false) {
                return {
                    tone: "incomplete",
                    label: "Reconnect",
                    tooltip: `The ${connection.name || gw.connection} connection needs to be re-authenticated.`,
                }
            }
            return undefined
        },
        [gatewayToolViews, actionAvailability, connectionLookup],
    )
    // Section rollup counts for the header indicator/tooltips.
    const toolResolutionSummary = useMemo(() => {
        let unresolved = 0
        let reconnect = 0
        for (const index of gatewayToolViews.keys()) {
            const s = toolResolutionStatus(index)
            if (s?.tone === "invalid") unresolved += 1
            else if (s?.tone === "incomplete") reconnect += 1
        }
        return {unresolved, reconnect}
    }, [gatewayToolViews, toolResolutionStatus])

    // A blocking resolution problem outranks draft markers; structural invalid stays first.
    const toolStatusFor = useMemo(() => {
        const base = statusForKind("tool")
        return (item: unknown, index: number): ItemRowStatus | undefined => {
            const baseStatus = base(item, index)
            if (baseStatus?.tone === "invalid") return baseStatus
            return toolResolutionStatus(index) ?? baseStatus
        }
    }, [statusForKind, toolResolutionStatus])
    const mcpStatusFor = useMemo(() => statusForKind("mcp"), [statusForKind])
    const skillStatusFor = useMemo(() => statusForKind("skill"), [statusForKind])

    // Section headers: a blocking problem (invalid) outranks unsaved edits (draft).
    const sectionInvalidTip = (key: string): string | null => {
        if (key === "model-harness") {
            if (mh.hasModelOrHarness && !modelIdFromConfig(config.llm))
                return "No model is selected."
            if (mh.modelUnsupported) return "The selected model isn't available on this harness."
            return null
        }
        if (key === "tools") {
            if (tools.some((t) => ITEM_KINDS.tool.draftInvalid(t as Record<string, unknown>)))
                return "A tool is missing its name."
            if (toolResolutionSummary.unresolved > 0)
                return "A connected-app tool couldn't be resolved — its action or connection may have been renamed or removed."
            return null
        }
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
    // Structurally valid but missing setup the section needs to run (amber, ranks below invalid).
    const sectionIncompleteTip = (key: string): string | null => {
        if (key === "model-harness" && mh.needsProviderKey)
            return "Connect the model's provider key to run this agent."
        if (key === "tools" && toolResolutionSummary.reconnect > 0)
            return "A connected app needs to be re-authenticated."
        return null
    }
    const headerIndicator = (
        key: string,
    ): {tone: "draft" | "invalid" | "incomplete"; tooltip?: string} | undefined => {
        const invalid = sectionInvalidTip(key)
        if (invalid) return {tone: "invalid", tooltip: invalid}
        const incomplete = sectionIncompleteTip(key)
        if (incomplete) return {tone: "incomplete", tooltip: incomplete}
        if (draftSectionKeys.has(key))
            return {
                tone: "draft",
                tooltip: DRAFT_TIP[key] ?? "Unsaved changes — not yet committed.",
            }
        return undefined
    }
    // A short pill rendered next to a section title for the blocking cases the user must resolve,
    // matching the header indicator's tone. Kept terse so it never crowds the title (the section
    // shell truncates the title and keeps the pill `shrink-0`).
    const sectionBadge = (key: string): React.ReactNode => {
        if (key !== "model-harness") return null
        const pill = (label: string, tone: "warning" | "error") => (
            <span
                className={cn(
                    "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
                    tone === "error"
                        ? "bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorError)]"
                        : "bg-[var(--ag-colorWarningBg)] text-[var(--ag-colorWarning)]",
                )}
            >
                {label}
            </span>
        )
        if (mh.hasModelOrHarness && !modelIdFromConfig(config.llm)) return pill("No model", "error")
        if (mh.modelUnsupported) return pill("Unavailable", "error")
        if (mh.needsProviderKey) return pill("Connect key", "warning")
        return null
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
            ? () => {
                  // Opening the picker is the point the workflow list is actually needed — activate
                  // the (lazy) bridge so it resolves now instead of on every playground load.
                  workflowReference.activate?.()
                  setReferenceSelectorOpen(true)
              }
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
            defaultOpen: tools.length > 0,
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
            title: fieldTitle("mcps", "MCPs"),
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
        // --- Operational sections: NOT part of the draftable/committable agent config (no
        // classifier bucket, own persistence). Grouped under an "Operations" header below the
        // configuration sections.
        {
            key: "triggers",
            group: "operations",
            icon: <Lightning size={16} />,
            title: "Triggers",
            summary: countSummary(triggerCount, "trigger"),
            extra: !disabled ? <AddTriggerDropdown entityId={revisionId} /> : undefined,
            defaultOpen: triggerCount > 0,
            content: <TriggerManagementSection entityId={revisionId} disabled={disabled} />,
        },
        {
            key: "mounts",
            group: "operations",
            icon: <HardDrives size={16} />,
            title: "Mounts",
            summary: (
                <span className="text-xs text-[var(--ag-colorTextTertiary)]">Coming soon</span>
            ),
            defaultOpen: false,
            // STUB: agent-scoped (artifact-level) mounts don't exist yet — this is a placeholder for
            // the agent's durable workspace. A live conversation's files are in the chat session panel.
            content: (
                <Typography.Text type="secondary" className="text-xs">
                    The agent&rsquo;s durable workspace — the memory and artifacts it accumulates
                    across runs — will live here once agent-level mounts land. A
                    conversation&rsquo;s live files are available in the session panel beside the
                    chat.
                </Typography.Text>
            ),
        },
    ].filter(Boolean) as {
        key: string
        group?: "operations"
        icon: React.ReactNode
        title: React.ReactNode
        summary?: React.ReactNode
        extra?: React.ReactNode
        indicator?: {tone: SectionIndicatorTone; tooltip?: string}
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

    // "Operations" heads the operational sections (triggers, mounts) — typography matches the
    // panel's "Configuration" header (PlaygroundVariantConfigHeader) so the two regions read as
    // peers, not as another collapsible section.
    const firstOpsKey = sections.find((s) => s.group === "operations")?.key
    const opsHeader = (
        <div className="pt-5 pb-2">
            <span className="text-[13px] font-semibold text-[var(--ant-color-text)]">
                Operations
            </span>
        </div>
    )

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
                                <span className="truncate">{s.title}</span>
                                {sectionBadge(s.key)}
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
                        <Fragment key={s.key}>
                            {s.key === firstOpsKey ? opsHeader : null}
                            <ConfigAccordionSection
                                icon={s.icon}
                                title={s.title}
                                titleBadge={sectionBadge(s.key)}
                                summary={s.summary}
                                extra={s.extra}
                                indicator={s.indicator ?? agentChangeIndicator(s.key)}
                                onOpen={s.onOpen}
                                collapsible={false}
                                noDivider
                                className={sectionCardClass}
                            >
                                {s.content}
                            </ConfigAccordionSection>
                        </Fragment>
                    ))}
                </div>
            ) : (
                sections.map((s, index) => (
                    <Fragment key={s.key}>
                        {s.key === firstOpsKey ? opsHeader : null}
                        <ConfigAccordionSection
                            icon={s.icon}
                            title={s.title}
                            titleBadge={sectionBadge(s.key)}
                            summary={s.summary}
                            extra={s.extra}
                            indicator={s.indicator ?? agentChangeIndicator(s.key)}
                            onOpen={s.onOpen}
                            defaultOpen={s.defaultOpen}
                            noDivider={index === sections.length - 1}
                            // Mount collapsed, then unfold via the normal collapse transition — first
                            // paint matches the skeleton's collapsed rows instead of shifting the layout.
                            animateInitialOpen
                        >
                            {s.content}
                        </ConfigAccordionSection>
                    </Fragment>
                ))
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
                dirty={sectionDirty}
                width={mh.modelHarnessDrawerWidth}
            >
                <ModelHarnessSectionDrawerBody
                    section="model-harness"
                    schema={schema}
                    config={draftConfig ?? config}
                    onChange={applyDraftConfig}
                    disabled={disabled}
                    withTooltip={withTooltip}
                    revisionId={revisionId}
                    buildKitEnabledOverride={draftBuildKitOverride}
                    savedHarnessValue={savedHarnessValue}
                />
            </SectionDrawer>

            <SectionDrawer
                open={openSection === "advanced"}
                title="Advanced"
                icon={<SlidersHorizontal size={16} />}
                onCancel={cancelSection}
                onSave={saveSection}
                disabled={disabled || !sectionDirty}
                dirty={sectionDirty}
                width={880}
            >
                <ModelHarnessSectionDrawerBody
                    section="advanced"
                    schema={schema}
                    config={draftConfig ?? config}
                    onChange={applyDraftConfig}
                    disabled={disabled}
                    withTooltip={withTooltip}
                    revisionId={revisionId}
                    buildKitEnabledOverride={draftBuildKitOverride}
                    savedHarnessValue={savedHarnessValue}
                />
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
                    onRemoveToolByIdentity={removeGatewayToolByIdentity}
                    selectedGatewayIds={selectedGatewayIds}
                    defaultIntegrationKey={integrationDefaultKey}
                />
            )}
        </div>
    )
}
