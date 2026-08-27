/**
 * AgentTemplateControl
 *
 * The agent playground's left config panel. It renders the whole agent config as a set
 * of collapsible accordion sections (Model, Instructions, Tools, MCP servers,
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
import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {toolActionAvailabilityKey, useToolActionAvailability} from "@agenta/entities/gatewayTool"
import type {SchemaProperty} from "@agenta/entities/shared"
import {
    agentCreationPrefsAtom,
    workflowBuildKitDisabledOpsAtomFamily,
    workflowBuildKitEnabledAtomFamily,
    type BuildKitUiState,
} from "@agenta/entities/workflow"
import {agentItemIdentity, stableStringify} from "@agenta/entities/workflow/commitDiff"
import {draftConfigChangeSignalAtom, openAgentConfigSectionAtom} from "@agenta/shared/state"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {useRecentFlag, type SectionIndicatorTone} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {Cpu, FileText, GraduationCap, Plugs, SlidersHorizontal, Wrench} from "@phosphor-icons/react"
import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue, useStore} from "jotai"

import {ChangedPathsProvider} from "../../drawers/shared"
import {useOptionalDrillIn} from "../components/MoleculeDrillInContext"

import {AddTextLink} from "./AddTextLink"
import {useAutoExpandOnPopulate} from "./agentSectionAutoExpand"
import {AgentIntegrationDrawer} from "./agentTemplate/AgentIntegrationDrawer"
import {
    AgentTemplateSectionList,
    type AgentTemplateSectionDescriptor,
} from "./agentTemplate/AgentTemplateSectionList"
import {countSummary} from "./agentTemplate/agentTemplateUtils"
import {AgentToolSelectorPopover} from "./agentTemplate/AgentToolSelectorPopover"
import {ConfigItemList} from "./agentTemplate/ConfigItemList"
import {ITEM_KINDS, type ItemKind} from "./agentTemplate/itemKinds"
import {InstructionsFileRow, type ItemRowStatus} from "./agentTemplate/ItemRow"
import {SectionAddButton} from "./agentTemplate/SectionAddButton"
import {SectionChangeBody} from "./agentTemplate/SectionChangeBody"
import {
    revertPathsTo,
    useAgentSectionChanges,
    type PanelSectionKey,
} from "./agentTemplate/sectionChanges"
import {SectionTitleBadge} from "./agentTemplate/SectionTitleBadge"
import {ToolManagementList} from "./agentTemplate/ToolManagementList"
import {useAgentTools} from "./agentTemplate/useAgentTools"
import {useConfigItemDrawer} from "./agentTemplate/useConfigItemDrawer"
import {useModelHarness} from "./agentTemplate/useModelHarness"
import {ConfigItemDrawer} from "./ConfigItemDrawer"
import {connectionFromConfig, modelIdFromConfig} from "./connectionUtils"
import {InstructionsDrawer} from "./InstructionsDrawer"
import {JsonObjectEditor} from "./JsonObjectEditor"
import {SectionDrawer} from "./SectionDrawer"
import {
    isHarnessBuiltinTool,
    parseGatewayTool,
    type ParsedGatewayTool,
    type ToolObj,
} from "./toolUtils"
import {useAgentTriggers} from "./TriggerManagementSection"
import {WorkflowReferenceSelector} from "./WorkflowReferenceSelector"

// Tooltip copy for the config-panel draft/validation indicators.
const INVALID_ITEM_TIP: Record<ItemKind, string> = {
    tool: "This tool is missing its name.",
    mcp: "This server is missing its name or URL.",
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

// A section's body, in its own component so `useModelHarness` runs HERE rather than in the parent.
// Two reasons, both load-bearing:
//  1. Context. The hook itself reads the changed-paths / focus filters (to mark rows, open the group
//     that changed, and narrow to it). React resolves context at the READER's position, so the hook
//     must run BELOW the providers — wrapping its output in them does nothing. A body rendered from
//     the parent's `mh` silently ignores both filters.
//  2. Cost. `useModelHarness` carries harness-catalog + vault-secrets + build-kit-overlay
//     subscriptions; mounting it per body keeps them scoped to the bodies that are on screen
//     (`SectionDrawer` uses `destroyOnClose`).
const ModelHarnessSectionBody = ({
    section,
    ...params
}: {
    section: "model-harness" | "advanced"
} & Parameters<typeof useModelHarness>[0]) => {
    const mh = useModelHarness(params)
    if (section === "advanced") {
        return <>{mh.advancedDrawerBody}</>
    }
    return <>{mh.modelHarnessBody}</>
}

// The four list sections whose open-state is controlled so the accordion can auto-expand when
// the agent populates them (see `useAutoExpandOnPopulate`).
const CONTROLLED_SECTION_KEYS = new Set(["tools", "mcp", "skills", "triggers"])

export const AgentTemplateControl = memo(function AgentTemplateControl({
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
    // The content we opened with — Save is gated on a real diff against it, like the section drawers.
    const [instructionOriginal, setInstructionOriginal] = useState("")
    const openInstruction = useCallback((filename: string, content: string) => {
        setInstructionDraft(content)
        setInstructionOriginal(content)
        setEditingInstruction({filename})
    }, [])
    const instructionDirty = instructionDraft !== instructionOriginal

    // Section drawers (Model & harness, Advanced) use a SCOPED draft: edits are buffered locally and
    // relayed to the entity only on Save (Cancel discards; Save is gated on a real diff vs. the value
    // we opened with). The build-kit state lives OUTSIDE the config (playground-only atoms), so it is
    // buffered alongside the config draft and committed to the atoms on Save.
    const [openSection, setOpenSection] = useState<null | "model-harness" | "advanced">(null)
    const [draftConfig, setDraftConfig] = useState<Record<string, unknown> | null>(null)
    const [draftBuildKit, setDraftBuildKit] = useState<BuildKitUiState | null>(null)
    const sectionBaseline = useRef<{
        config: Record<string, unknown>
        buildKit: BuildKitUiState
    } | null>(null)
    // The revision the open drawer was snapshotted against. State, not a ref: the drawer BODY reads
    // it during render, and both its overlay and Save must stay on it even if the active revision
    // changes underneath. Null whenever no section drawer is open.
    const [sectionRevision, setSectionRevision] = useState<string | null>(null)
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
                !deepEqual(draftBuildKit, sectionBaseline.current.buildKit)),
        [openSection, draftConfig, draftBuildKit],
    )
    const openSectionDrawer = useCallback(
        (key: "model-harness" | "advanced") => {
            // Same section already open: never re-snapshot over a live draft.
            if (openSection === key) return
            // Another section is open with unsaved edits: drop the request rather than clobber it.
            if (isCurrentSectionDirty()) return
            const snapshotConfig = (value ?? {}) as Record<string, unknown>
            const snapshotRevision = revisionIdRef.current ?? ""
            const snapshotBuildKit: BuildKitUiState = {
                enabled: store.get(workflowBuildKitEnabledAtomFamily(snapshotRevision)),
                disabledOps: store.get(workflowBuildKitDisabledOpsAtomFamily(snapshotRevision)),
            }
            setDraftConfig(snapshotConfig)
            setDraftBuildKit(snapshotBuildKit)
            setSectionRevision(snapshotRevision)
            sectionBaseline.current = {
                config: snapshotConfig,
                buildKit: snapshotBuildKit,
            }
            setOpenSection(key)
        },
        [value, store, openSection, isCurrentSectionDirty],
    )
    const closeSectionDraft = useCallback(() => {
        setOpenSection(null)
        setDraftConfig(null)
        setDraftBuildKit(null)
        setSectionRevision(null)
        sectionBaseline.current = null
    }, [])

    // Remote request to open a section drawer (e.g. the chat's connect-a-model banner → the Model section).
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
            // explicit Model-section save, not on every keystroke or the Advanced section.
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
                    // Not `?? prev.provider`: a custom-connection pick deliberately stores none,
                    // and inheriting the last family would seed the next agent with a provider its
                    // model contradicts.
                    provider: connection.provider ?? undefined,
                    connectionMode: connection.mode ?? prev.connectionMode,
                    connectionSlug: connection.slug ?? undefined,
                }))
            }
        }
        if (draftBuildKit !== null) {
            const revision = sectionRevision ?? revisionIdRef.current ?? ""
            store.set(workflowBuildKitEnabledAtomFamily(revision), draftBuildKit.enabled)
            store.set(workflowBuildKitDisabledOpsAtomFamily(revision), draftBuildKit.disabledOps)
        }
        closeSectionDraft()
    }, [
        draftConfig,
        draftBuildKit,
        openSection,
        sectionRevision,
        onChange,
        store,
        closeSectionDraft,
    ])
    // Enable Save only when the draft actually differs from what we opened with (config or build-kit).
    const sectionDirty = isCurrentSectionDirty()

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

    // Trigger count for the section auto-expand/summary state (the Triggers UI itself now lives in
    // the sibling AgentOperationsSections; this shares the same deduped query).
    const {count: triggerCount} = useAgentTriggers(revisionId)

    // ── Agent self-commit: surface WHAT the agent just changed ──────────────────────────
    // The chat raises the signal (with the outgoing revision's parameters) when the agent
    // commits itself and the playground switches in place. Once this control renders the
    // NEW revision, diff the configs per section and mark the changed ones. The computed
    // set is FROZEN on first non-empty result so the user's own subsequent edits don't
    // drift into the "agent changed this" indication. Dismiss (or the next commit) clears.
    // Both change sources for this revision, computed ONCE (see `sectionChanges`): `draft` is the
    // durable live-vs-committed diff, `agent` is the frozen self-commit diff. Every consumer —
    // header indicators, the drawers' property marks — reads this same result.
    const sectionChanges = useAgentSectionChanges(revisionId, config)
    const agentChangedKeys = sectionChanges.agent?.panelKeys ?? null
    const agentChangeIndicator = useCallback(
        (sectionKey: string) => {
            if (!agentChangedKeys?.has(sectionKey as PanelSectionKey)) return undefined
            const version = sectionChanges.agentVersion
            return {
                tone: "agent" as const,
                tooltip: `Updated by the agent${version ? ` in ${version}` : ""}`,
            }
        },
        [agentChangedKeys, sectionChanges.agentVersion],
    )

    // ── Draft change from another pane (e.g. "always allow" in the approval dock) ────────
    // A user-initiated, UNCOMMITTED write to this revision's draft config already shows the
    // section's static "draft" dot (headerIndicator). When the write came from another pane,
    // make THAT dot pulse briefly for attention — the user acted in the dock, not here — instead
    // of adding a competing indicator. Rides on whatever tone the section already carries.
    const draftSignal = useAtomValue(draftConfigChangeSignalAtom)
    const draftActive = Boolean(draftSignal && revisionId && draftSignal.revisionId === revisionId)
    // Covers the two 1.8s pulse sweeps (~3.6s) plus a small buffer, so the ripple/shimmer finish
    // on their invisible end frame before unmounting — no end-of-pulse flash.
    const draftRecent = useRecentFlag(draftActive ? draftSignal!.at : null, 3900)
    const withDraftPulse = useCallback(
        (
            sectionKey: string,
            base: {tone: SectionIndicatorTone; tooltip?: React.ReactNode} | undefined,
        ): {tone: SectionIndicatorTone; tooltip?: React.ReactNode; pulse?: boolean} | undefined => {
            if (!draftActive || !draftRecent || !draftSignal!.sectionKeys.includes(sectionKey)) {
                return base
            }
            if (base) return {...base, pulse: true}
            return {
                tone: "draft",
                tooltip: `${draftSignal!.summary ?? "Changed here"} — pending, applies on the next run`,
                pulse: true,
            }
        },
        [draftActive, draftRecent, draftSignal],
    )

    // Model & harness + Advanced own a lot of coupled, stateful logic (the model/connection state
    // feeds both sections), so they live in their own hook that returns the summaries + bodies.
    //
    // TWO instances, on purpose:
    //  - `mh` is bound to the LIVE entity — it drives the accordion header summaries. Keeping it live
    //    means a section header NEVER reflects the drawer's unsaved draft
    //    (the reported bug: editing in the open drawer updated the background summary).
    //  - The DRAFT instance (config + build-kit buffer) that drives the OPEN section drawer's body
    //    now lives inside `ModelHarnessSectionBody`, mounted only while a drawer/inline body is on screen, so
    //    its harness/vault/overlay subscriptions don't run in the background.
    const mh = useModelHarness({schema, config, onChange, disabled, withTooltip, revisionId})
    const draftBuildKitOverride = useMemo(
        () =>
            draftBuildKit !== null ? {value: draftBuildKit, onChange: setDraftBuildKit} : undefined,
        [draftBuildKit],
    )

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

    // Legacy harness built-in entries render nowhere (ToolManagementList drops them), so the
    // header count and the section's open state must ignore them too.
    const visibleToolCount = useMemo(
        () => tools.filter((tool) => !isHarnessBuiltinTool(tool)).length,
        [tools],
    )

    // External HTTP MCP servers from the saved agent template.
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

    // Controlled open-state for the four list sections so the accordion can react to the agent
    // populating a section. Seeded once from the initial counts; the edge hook below flips it.
    const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>(() => ({
        tools: visibleToolCount > 0,
        mcp: mcpServers.length > 0,
        skills: skills.length > 0,
        triggers: triggerCount > 0,
    }))
    const setSectionOpenByKey = useCallback(
        (key: string, open: boolean) =>
            setSectionOpen((m) => (m[key] === open ? m : {...m, [key]: open})),
        [],
    )
    const sectionCounts = useMemo(
        () => ({
            tools: visibleToolCount,
            mcp: mcpServers.length,
            skills: skills.length,
            triggers: triggerCount,
        }),
        [visibleToolCount, mcpServers.length, skills.length, triggerCount],
    )
    useAutoExpandOnPopulate(sectionCounts, setSectionOpenByKey)

    // ``instructions.agents_md`` is the one instruction document (flat on the template).
    const instructions =
        config.instructions && typeof config.instructions === "object"
            ? (config.instructions as Record<string, unknown>)
            : {}
    const agentsMd = (instructions.agents_md as string | null | undefined) ?? null

    const hasInstructions = Boolean(props.instructions)
    const hasTools = Boolean(props.tools)
    const hasMcp = Boolean(props.mcps) && mh.mcpSupported
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
    // The same committed baseline the section diff uses (see `useAgentSectionChanges`) — read once
    // there rather than subscribing to `serverConfiguration` a second time and re-unwrapping it.
    const committed = sectionChanges.committed

    // Header rollup: which sections changed vs the commit — from the shared diff above, so the
    // grouping matches the classifier's (model+harness together; advanced = runner/sandbox/params)
    // and the indicators, the drawers' property marks, and any summary can never disagree.
    const draftSectionKeys = sectionChanges.draft.panelKeys

    // Revert for the SECTION DRAWERS: restore the given paths to their committed values through the
    // drawer's scoped draft (`applyDraftConfig`), never straight to the entity — so an undo behaves
    // like any other edit in there and Cancel/Save still mean what they say.
    const drawerChangedPaths = useMemo(
        () => ({
            ...sectionChanges.draft,
            revert: (paths: string[]) =>
                applyDraftConfig(revertPathsTo(draftConfig ?? config, committed, paths)),
        }),
        [sectionChanges.draft, applyDraftConfig, committed, draftConfig, config],
    )

    // Revert for the PANEL's own inline bodies: writes the entity draft straight through `onChange`,
    // matching how the panel's other inline sections (Tools, Instructions) already behave. Distinct
    // from `drawerChangedPaths` above — the drawer has a scoped draft to respect, the panel doesn't.
    const panelChangedPaths = useMemo(
        () => ({
            ...sectionChanges.draft,
            revert: (paths: string[]) => onChange(revertPathsTo(config, committed, paths)),
        }),
        [sectionChanges.draft, onChange, config, committed],
    )
    // The inline body for a drawer-backed section: its own controls, narrowed to what changed — the
    // same affordance as the Connect-key field, with a different filter (see SectionChangeBody).
    // The body is a COMPONENT rendered inside the providers, never `mh`'s pre-built output: the hook
    // reads these filters itself, and context resolves at the reader's position.
    const changeBodyFor = useCallback(
        (key: PanelSectionKey) => {
            // The classifier already assigns each changed path to its own section bucket; read this
            // section's paths from there so Advanced never picks up an instructions/tools/mcp/skills edit.
            const section = sectionChanges.draft.sectionsByKey.get(key)
            const sectionPaths = (section?.scalarChanges ?? []).map((c) => c.key)
            if (!sectionPaths.length) return null
            return (
                <SectionChangeBody
                    paths={sectionPaths}
                    onOpenDetails={() => openSectionDrawer(key as "model-harness" | "advanced")}
                    disabled={disabled}
                    changes={panelChangedPaths}
                >
                    <ModelHarnessSectionBody
                        section={key as "model-harness" | "advanced"}
                        schema={schema}
                        config={config}
                        onChange={onChange}
                        disabled={disabled}
                        withTooltip={withTooltip}
                        revisionId={revisionId}
                    />
                </SectionChangeBody>
            )
        },
        [
            sectionChanges.draft,
            openSectionDrawer,
            panelChangedPaths,
            disabled,
            schema,
            config,
            onChange,
            withTooltip,
            revisionId,
        ],
    )

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
                    return {tone: "new", label: "New", tooltip: "Added since the last version."}
                return {tone: "edited", label: "Edited", tooltip: "Edited — not saved yet."}
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
                ? "An MCP server is missing its name or URL."
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
        if (draftSectionKeys.has(key as PanelSectionKey))
            return {
                tone: "draft",
                tooltip: DRAFT_TIP[key] ?? "Unsaved changes.",
            }
        return undefined
    }
    // Final header indicator for a section: validation/draft state, falling back to the agent's
    // self-commit mark, with the cross-pane draft pulse layered on. One place so the drawers, the
    // marks, and the header can never disagree.
    const sectionIndicator = (key: string) =>
        withDraftPulse(key, headerIndicator(key) ?? agentChangeIndicator(key))

    // The blocking cases the user must resolve, as a short pill next to the Model section title.
    const modelHarnessBadge: React.ReactNode =
        mh.hasModelOrHarness && !modelIdFromConfig(config.llm) ? (
            <SectionTitleBadge label="No model" tone="error" />
        ) : mh.modelUnsupported ? (
            <SectionTitleBadge label="Unavailable" tone="error" />
        ) : mh.needsProviderKey ? (
            <SectionTitleBadge label="Connect key" tone="warning" />
        ) : null

    const instructionsStatus: ItemRowStatus | undefined = draftSectionKeys.has("instructions")
        ? {tone: "edited", label: "Edited", tooltip: "Edited — not saved yet."}
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

    // Compact "+" for a section header's `extra` slot. The header keeps a uniform height regardless
    // of this button — ConfigAccordionSection collapses the extra slot's vertical footprint (see its
    // `-my-2`), so no per-button sizing is needed here.
    const headerAddButton = (label: string, onClick: () => void) => (
        <SectionAddButton label={label} onClick={onClick} />
    )

    // The inline "what changed" body for the drawer-backed Advanced section. Null when the section
    // is clean, which is what keeps it a plain drawer-opening row.
    const advancedChangeBody = changeBodyFor("advanced")

    // Each config section as a descriptor, so it can be rendered in any layout (accordion /
    // tabs / cards) without duplicating the content. Schema-gated, like before.
    const sections = [
        mh.hasModelOrHarness && {
            key: "model-harness",
            icon: <Cpu size={16} />,
            title: "Model",
            titleBadge: modelHarnessBadge,
            summary: mh.modelSummary,
            indicator: sectionIndicator("model-harness"),
            // A model still to connect is the one thing that opens the section by itself — the list
            // holds the affordance that fixes it.
            defaultOpen: Boolean(mh.needsProviderKey),
            // The section EXPANDS (it carries no `onOpen`, which is what routes a header to a drawer
            // instead): the connection list renders right here. The drawer survives for the chat's
            // "connect a model" banner and for the Advanced section; it is just no longer where this
            // header leads.
            content: (
                <ChangedPathsProvider changes={panelChangedPaths}>
                    <ModelHarnessSectionBody
                        section="model-harness"
                        schema={schema}
                        config={config}
                        onChange={onChange}
                        disabled={disabled}
                        withTooltip={withTooltip}
                        revisionId={revisionId}
                    />
                </ChangedPathsProvider>
            ),
        },
        hasInstructions && {
            key: "instructions",
            icon: <FileText size={16} />,
            title: fieldTitle("instructions", "Instructions"),
            summary: countSummary(1, "file"),
            indicator: sectionIndicator("instructions"),
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
            summary: countSummary(visibleToolCount, "tool"),
            indicator: sectionIndicator("tools"),
            extra: !disabled ? (
                <AgentToolSelectorPopover
                    {...toolSelectorProps}
                    trigger={<SectionAddButton label="Add tool" disabled={disabled} />}
                />
            ) : undefined,
            defaultOpen: visibleToolCount > 0,
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
            indicator: sectionIndicator("mcp"),
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
            indicator: sectionIndicator("skills"),
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
            indicator: sectionIndicator("advanced"),
            // Never self-opening: nothing in Advanced blocks a run (see `needsProviderKeyInline`).
            defaultOpen: false,
            summary: mh.advancedSummary,
            // Uncommitted changes → show them inline (dropping `onOpen` is what expands a section
            // instead of routing to the drawer). Nothing changed → the plain drawer row.
            ...(advancedChangeBody
                ? {content: advancedChangeBody}
                : {
                      onOpen: () => openSectionDrawer("advanced"),
                      content: mh.advancedDrawerBody,
                  }),
        },
    ].filter(Boolean) as AgentTemplateSectionDescriptor[]

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
            <AgentTemplateSectionList
                sections={sections}
                controlledKeys={CONTROLLED_SECTION_KEYS}
                openByKey={sectionOpen}
                onOpenChange={setSectionOpenByKey}
            />

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
                    dirty={instructionDirty}
                />
            )}

            <SectionDrawer
                open={openSection === "model-harness"}
                title="Model"
                icon={<Cpu size={16} />}
                onCancel={cancelSection}
                onSave={saveSection}
                disabled={disabled || !sectionDirty}
                dirty={sectionDirty}
                width={mh.modelHarnessDrawerWidth}
            >
                {/* Marks the exact properties that changed since the commit (and opens the
                    sub-sections holding them). Must sit ABOVE the body: `useModelHarness` reads the
                    context at its own position, so a provider rendered *by* the body wouldn't reach
                    it. Scoped to the draft diff — the drawer's own unsaved edits are its Save gate's
                    business, not "what changed since the commit". */}
                <ChangedPathsProvider changes={drawerChangedPaths}>
                    <ModelHarnessSectionBody
                        section="model-harness"
                        schema={schema}
                        config={draftConfig ?? config}
                        onChange={applyDraftConfig}
                        disabled={disabled}
                        withTooltip={withTooltip}
                        revisionId={sectionRevision ?? revisionId}
                        buildKitOverride={draftBuildKitOverride}
                    />
                </ChangedPathsProvider>
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
                <ChangedPathsProvider changes={drawerChangedPaths}>
                    <ModelHarnessSectionBody
                        section="advanced"
                        schema={schema}
                        config={draftConfig ?? config}
                        onChange={applyDraftConfig}
                        disabled={disabled}
                        withTooltip={withTooltip}
                        revisionId={sectionRevision ?? revisionId}
                        buildKitOverride={draftBuildKitOverride}
                    />
                </ChangedPathsProvider>
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
})
