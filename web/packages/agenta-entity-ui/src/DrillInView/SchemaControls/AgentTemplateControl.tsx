/**
 * AgentTemplateControl
 *
 * The agent playground's left config panel. It renders the whole agent config as a set
 * of collapsible accordion sections (Model, Instructions, Integrations, Subagents,
 * MCP servers, Permissions, Advanced), built on the reusable {@link ConfigAccordionSection} primitive
 * so the same pattern can roll out to other config surfaces.
 *
 * Dispatched from `x-ag-type: "agent-template"` / `x-ag-type-ref: "agent-template"` (see
 * SchemaPropertyRenderer). Its `value` IS the agent template (the `parameters.agent` object,
 * just as the prompt control's value is the prompt template): the portable definition
 * (instructions/llm/tools/mcps/skills) is FLAT on it, and the execution parts
 * (harness/runner/sandbox) are nested sub-objects. It reuses the existing schema controls rather
 * than inventing new ones: the model selector (GroupedChoiceControl), the integration and
 * subagent lists (ToolManagementList + SubagentList), the MCP server editor (McpServerItemControl), enum
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
    agentRequirementsAtomFamily,
    isPersonalRequirement,
    modelRequirement,
    requirementAtPath,
    requirementForItem,
    workflowBuildKitUiStateAtomFamily,
    migrateBuildKitStateAtom,
    type BuildKitUiState,
} from "@agenta/entities/workflow"
import {agentItemIdentity, stableStringify} from "@agenta/entities/workflow/commitDiff"
import {createT, getActiveLanguage, useT, type CatalogKey} from "@agenta/i18n"
import agentTemplateCatalog from "@agenta/i18n/catalogs/entityUi.agentTemplate"
import {draftConfigChangeSignalAtom, openAgentConfigSectionAtom} from "@agenta/shared/state"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {useRecentFlag, type SectionIndicatorTone} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    Spinner,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {useViewOpener, type ConfigItemRef, type ViewTarget} from "@agenta/ui/view-stack"
import {UploadSimple} from "@phosphor-icons/react"
import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue, useStore} from "jotai"

import {ChangedPathsProvider} from "../../drawers/shared"
import {useOptionalDrillIn} from "../components/MoleculeDrillInContext"

import {mergeAgentConfigDraft} from "./agentConfigPatch"
import {useAutoExpandOnPopulate} from "./agentSectionAutoExpand"
import {
    AgentTemplateSectionList,
    type AgentTemplateSectionDescriptor,
} from "./agentTemplate/AgentTemplateSectionList"
import {
    embedRevisionVersion,
    isEmbedRefSkill,
    isStaticSkill,
    staticEmbedSlug,
} from "./agentTemplate/itemDescriptors"
import {ITEM_KINDS, type ItemKind} from "./agentTemplate/itemKinds"
import {integrationItemRef, removeIntegrationByRef} from "./agentTemplate/itemKinds/tool"
import type {ItemRowStatus} from "./agentTemplate/ItemRow"
import {removeMcpByRef} from "./agentTemplate/mcpRail"
import {isNeedsSetupStatus, needsSetupStatus} from "./agentTemplate/needsSetup"
import {modelNeedsSetupMessage, needsSetupLabel} from "./agentTemplate/needsSetupText"
import {SectionChangeBody} from "./agentTemplate/SectionChangeBody"
import {
    revertPathsTo,
    useAgentSectionChanges,
    type PanelSectionKey,
} from "./agentTemplate/sectionChanges"
import {advancedSection} from "./agentTemplate/sections/AdvancedSection"
import {agentMcpSection} from "./agentTemplate/sections/AgentMcpSection"
import {instructionsSection} from "./agentTemplate/sections/InstructionsSection"
import {
    IntegrationRemoveDialog,
    integrationsSection,
} from "./agentTemplate/sections/IntegrationsSection"
import {ModelHarnessSectionBody} from "./agentTemplate/sections/ModelHarnessSectionBody"
import {modelSection} from "./agentTemplate/sections/ModelSection"
import {permissionsSection} from "./agentTemplate/sections/PermissionsSection"
import {skillsSection} from "./agentTemplate/sections/SkillsSection"
import {subagentsSection} from "./agentTemplate/sections/SubagentsSection"
import {removeSubagentByRef} from "./agentTemplate/subagentReference"
import {selectSubagentTools} from "./agentTemplate/ToolManagementList"
import {AgentEditorContext, type AgentEditor} from "./agentTemplate/useAgentConfigWriter"
import {useAgentTools} from "./agentTemplate/useAgentTools"
import {useConfigItemDrawer} from "./agentTemplate/useConfigItemDrawer"
import {useModelHarness} from "./agentTemplate/useModelHarness"
import {instructionsView} from "./agentTemplate/views/instructionsView"
import {integrationAddView} from "./agentTemplate/views/integrationAddView"
import {integrationView} from "./agentTemplate/views/integrationView"
import {mcpAddView} from "./agentTemplate/views/mcpAddView"
import {mcpServerView} from "./agentTemplate/views/mcpServerView"
import {modelView} from "./agentTemplate/views/modelView"
import {subagentAddView} from "./agentTemplate/views/subagentAddView"
import {subagentView} from "./agentTemplate/views/subagentView"
import {ConfigItemDrawer} from "./ConfigItemDrawer"
import {modelIdFromConfig} from "./connectionUtils"
import {SkillFormSkeleton} from "./DrawerSkeletons"
import {JsonObjectEditor} from "./JsonObjectEditor"
import {SectionDrawer} from "./SectionDrawer"
import {
    integrationRowIndices,
    parseGatewayEntry,
    type GatewayEntry,
    type IntegrationRow,
} from "./toolUtils"
import {useAgentTriggers} from "./TriggerManagementSection"

const tNow = createT(agentTemplateCatalog)

// Tooltip copy for the config-panel draft/validation indicators.
type AgentTemplateKey = CatalogKey<typeof agentTemplateCatalog>

const INVALID_ITEM_TIP: Record<ItemKind, AgentTemplateKey> = {
    tool: "entityUi.agentTemplate.toolMissingName",
    mcp: "entityUi.agentTemplate.serverMissingName",
    skill: "entityUi.agentTemplate.skillMissingName",
}
const DRAFT_TIP: Record<string, AgentTemplateKey> = {
    "model-harness": "entityUi.agentTemplate.draftModelHarness",
    instructions: "entityUi.agentTemplate.draftInstructions",
    tools: "entityUi.agentTemplate.draftTools",
    subagents: "entityUi.agentTemplate.draftSubagents",
    mcp: "entityUi.agentTemplate.draftMcp",
    skills: "entityUi.agentTemplate.draftSkills",
    advanced: "entityUi.agentTemplate.draftAdvanced",
    permissions: "entityUi.agentTemplate.draftPermissions",
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

// The four list sections whose open-state is controlled so the accordion can auto-expand when
// the agent populates them (see `useAutoExpandOnPopulate`).
/** Stable no-op stand-in when no skills bridge is wired (hook order must not depend on data). */
const useNoHeadVersions = (): Record<string, string> => EMPTY_HEAD_VERSIONS
const EMPTY_HEAD_VERSIONS: Record<string, string> = {}

const CONTROLLED_SECTION_KEYS = new Set(["tools", "subagents", "mcp", "skills", "triggers"])

export const AgentTemplateControl = memo(function AgentTemplateControl({
    schema,
    value,
    onChange,
    withTooltip,
    disabled,
    className,
}: AgentTemplateControlProps) {
    const t = useT(agentTemplateCatalog)
    const {gatewayTools, workflowReference, skills: skillsBridge} = useDrillInUI()
    const config = (value ?? {}) as Record<string, unknown>

    // Latest config, so an async write (e.g. after a schema lookup) doesn't clobber concurrent edits.
    const configRef = useRef(config)
    useEffect(() => {
        configRef.current = config
    }, [config])

    // The open revision id (from drill-in context): the views' target, harness-capability
    // inspection (inside useModelHarness) and bound-trigger scoping all key off it.
    const drillIn = useOptionalDrillIn<unknown>()
    const revisionId = drillIn?.entityId ?? null
    // Rows and "+" open views: in the container's stack, or, in a host with none, in a drawer.
    const views = useViewOpener()
    const openView = views.open
    const editor = useMemo<AgentEditor | null>(
        () => (revisionId ? {revisionId, readOnly: Boolean(disabled)} : null),
        [revisionId, disabled],
    )
    const viewTarget = useMemo<ViewTarget | null>(
        () => (revisionId ? {kind: "agent_draft", revisionId} : null),
        [revisionId],
    )

    const openAddIntegration = useCallback(() => {
        if (viewTarget) void openView(integrationAddView, {}, viewTarget)
    }, [openView, viewTarget])
    const openModel = useCallback(() => {
        if (viewTarget) void openView(modelView, {}, viewTarget)
    }, [openView, viewTarget, disabled])
    // The integration whose remove dialog is open (F06 f2).
    const [removingIntegration, setRemovingIntegration] = useState<IntegrationRow | null>(null)
    // Shared draft-then-save drawer for tools, MCP servers, and skills (writes via ITEM_KINDS).
    // Nothing is registered at save any more. An MCP item names a connection that already
    // exists, created by the connect journey, so committing one writes the reference and
    // nothing else.
    const prepareItemCommit = useCallback(
        async (_kind: ItemKind, item: Record<string, unknown>) => item,
        [],
    )
    const {
        editing,
        draft,
        setDraft,
        jsonInvalid,
        setJsonInvalid,
        openCreate,
        openEdit,
        closeEditor,
        commitDraft,
        commitError,
        committing,
        removeItem,
        draftInvalid,
        draftUnchanged,
    } = useConfigItemDrawer({config, onChange, prepareCommit: prepareItemCommit})

    // The instructions file list (one AGENTS.md today): a row opens the editor view.
    const openInstruction = useCallback(() => {
        if (viewTarget) void openView(instructionsView, {file: "AGENTS.md" as const}, viewTarget)
    }, [openView, viewTarget, disabled])

    // Section drawers (Model & harness, Advanced) use a SCOPED draft: edits are buffered locally and
    // relayed to the entity only on Save (Cancel discards; Save is gated on a real diff vs. the value
    // we opened with). The build-kit state lives OUTSIDE the config (playground-only atoms), so it is
    // buffered alongside the config draft and committed to the atoms on Save.
    const [openSection, setOpenSection] = useState<null | "advanced">(null)
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
            // The Model section is a view now; only Advanced keeps its drawer.
            if (key === "model-harness") {
                openModel()
                return
            }
            // Same section already open: never re-snapshot over a live draft.
            if (openSection === key) return
            // Another section is open with unsaved edits: drop the request rather than clobber it.
            if (isCurrentSectionDirty()) return
            const snapshotConfig = (value ?? {}) as Record<string, unknown>
            const snapshotRevision = revisionIdRef.current ?? ""
            store.set(migrateBuildKitStateAtom, snapshotRevision)
            const snapshotBuildKit = store.get(workflowBuildKitUiStateAtomFamily(snapshotRevision))
            setDraftConfig(snapshotConfig)
            setDraftBuildKit(snapshotBuildKit)
            setSectionRevision(snapshotRevision)
            sectionBaseline.current = {
                config: snapshotConfig,
                buildKit: snapshotBuildKit,
            }
            setOpenSection(key)
        },
        [value, store, openSection, isCurrentSectionDirty, openModel],
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
        if (sectionRevision !== (revisionIdRef.current ?? "")) {
            closeSectionDraft()
            return
        }
        if (draftConfig !== null && sectionBaseline.current !== null) {
            onChange(
                mergeAgentConfigDraft(
                    configRef.current,
                    sectionBaseline.current.config,
                    draftConfig,
                    openSection ?? undefined,
                ),
            )
        }
        if (draftBuildKit !== null && sectionBaseline.current !== null) {
            const revision = sectionRevision ?? revisionIdRef.current ?? ""
            if (!deepEqual(draftBuildKit, sectionBaseline.current.buildKit))
                store.set(workflowBuildKitUiStateAtomFamily(revision), draftBuildKit)
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

    revisionIdRef.current = revisionId
    // The server's needs-setup check for this saved revision; null until it answers.
    // A personal requirement belongs to each person who runs the agent, so the editor skips it.
    // The path and item lookups skip it themselves; the section summaries below filter it here.
    const requirements = useAtomValue(agentRequirementsAtomFamily(revisionId ?? ""))
    const editorRequirements = useMemo(
        () => requirements?.filter((r) => !isPersonalRequirement(r)) ?? null,
        [requirements],
    )
    const modelReq = editorRequirements ? modelRequirement(editorRequirements) : undefined
    const secretReq = requirements
        ? requirementAtPath(requirements, "sandbox.credentials")
        : undefined
    const mcpNeedsSetup = Boolean(
        editorRequirements?.some((r) => r.kind === "mcp_server" || r.kind === "mcp_sign_in"),
    )
    // A secret attach/edit/remove commits a new revision from inside the open drawer. Keep the
    // drawer open on it: re-snapshot the (clean) draft from the adopted revision instead of closing.
    const credentialRebaseTarget = useRef<string | null>(null)
    const rebaseSectionOnCredentialCommit = useCallback((nextRevisionId: string) => {
        credentialRebaseTarget.current = nextRevisionId
    }, [])
    useEffect(() => {
        if (!openSection || sectionRevision === (revisionId ?? "")) return
        const rebase =
            revisionId !== null &&
            credentialRebaseTarget.current === revisionId &&
            !isCurrentSectionDirty()
        credentialRebaseTarget.current = null
        if (!rebase) {
            closeSectionDraft()
            return
        }
        const snapshotConfig = (value ?? {}) as Record<string, unknown>
        store.set(migrateBuildKitStateAtom, revisionId)
        const snapshotBuildKit = store.get(workflowBuildKitUiStateAtomFamily(revisionId))
        setDraftConfig(snapshotConfig)
        setDraftBuildKit(snapshotBuildKit)
        setSectionRevision(revisionId)
        sectionBaseline.current = {config: snapshotConfig, buildKit: snapshotBuildKit}
    }, [
        revisionId,
        sectionRevision,
        openSection,
        closeSectionDraft,
        isCurrentSectionDirty,
        value,
        store,
    ])

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
                tooltip: version
                    ? tNow("entityUi.agentTemplate.updatedByAgentIn", {version})
                    : tNow("entityUi.agentTemplate.updatedByAgent"),
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
                tooltip: tNow("entityUi.agentTemplate.changedHerePending", {
                    summary: draftSignal!.summary ?? tNow("entityUi.agentTemplate.changedHere"),
                }),
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
    const mh = useModelHarness({
        schema,
        config,
        onChange,
        disabled,
        withTooltip,
        revisionId,
        normalizeSandbox: true,
    })
    const draftBuildKitOverride = useMemo(
        () =>
            draftBuildKit !== null ? {value: draftBuildKit, onChange: setDraftBuildKit} : undefined,
        [draftBuildKit],
    )

    // Tool add/remove (inline function, builtin, gateway, workflow reference) lives in its own hook.
    const {tools, integrationRows, migrateIntegrationEntries} = useAgentTools({
        config,
        onChange,
        configRef,
        openCreate,
    })

    /**
     * Open one integration's view. Migration runs HERE, on the click, and never on a page load:
     * viewing an untouched agent must not rewrite it. An integration whose legacy entries name two
     * or more connections is left alone and the view says why.
     */
    const openIntegrationPermissions = useCallback(
        (row: IntegrationRow) => {
            migrateIntegrationEntries({provider: row.provider, integration: row.integration})
            if (viewTarget)
                void openView(integrationView, {item: integrationItemRef(row)}, viewTarget)
        },
        [migrateIntegrationEntries, openView, viewTarget, disabled],
    )

    // The subagents, each keeping its index in `tools`: edit and remove address it by index.
    const subagentTools = useMemo(
        () => selectSubagentTools(tools, integrationRows),
        [tools, integrationRows],
    )
    // Each section counts only the kind it renders; what renders nowhere is counted nowhere.
    const integrationCount = integrationRows.length
    const subagentCount = subagentTools.length

    // External HTTP MCP servers from the saved agent template.
    const mcpServers = useMemo(
        () => (Array.isArray(config.mcps) ? (config.mcps as unknown[]) : []),
        [config.mcps],
    )
    // "+" and a server row open views, as Integrations does.
    const openAddMcp = viewTarget ? () => void openView(mcpAddView, {}, viewTarget) : undefined
    const openMcpServer = useCallback(
        (item: ConfigItemRef) => {
            if (viewTarget) void openView(mcpServerView, {item}, viewTarget)
        },
        [openView, viewTarget],
    )
    const removeMcpServer = useCallback(
        (item: ConfigItemRef) => {
            const latest = configRef.current
            onChange({
                ...latest,
                mcps: removeMcpByRef(
                    Array.isArray(latest.mcps) ? (latest.mcps as unknown[]) : [],
                    item,
                ),
            })
        },
        [onChange],
    )

    // Skills: a flat array of inline SKILL.md packages or `@ag.embed` references the backend inlines.
    const skills = useMemo(
        () => (Array.isArray(config.skills) ? (config.skills as unknown[]) : []),
        [config.skills],
    )
    // Registry-backed picker via the drill-in bridge (artboard 4b); the inline-skill
    // editor stays the fallback on hosts that never wired the bridge.
    const [skillPickerOpen, setSkillPickerOpen] = useState(false)
    // Row click on a project-owned embed ref opens the registry DETAIL drawer; static
    // embeds and shapes the bridge can't resolve keep the JSON round-trip editor.
    const [skillDetailSlug, setSkillDetailSlug] = useState<string | null>(null)
    const openSkillItem = useCallback(
        (kind: ItemKind, index: number, item: unknown) => {
            if (skillsBridge?.DetailHost && isEmbedRefSkill(item) && !isStaticSkill(item)) {
                const slug = staticEmbedSlug(item as Record<string, unknown>)
                if (slug) {
                    setSkillDetailSlug(slug)
                    return
                }
            }
            openEdit(kind, index, item)
        },
        [openEdit, skillsBridge],
    )
    const handleAddSkill = useCallback(() => {
        if (skillsBridge?.enabled) setSkillPickerOpen(true)
        else openCreate("skill", ITEM_KINDS.skill.createSeed())
    }, [openCreate, skillsBridge])
    /** Embed slugs already on this agent, with their pin — what the picker marks "Added". */
    const addedSkillRefs = useMemo(
        () =>
            skills
                .filter((entry) => isEmbedRefSkill(entry))
                .flatMap((entry): {slug: string; pinnedVersion?: string}[] => {
                    const record = entry as Record<string, unknown>
                    const slug = staticEmbedSlug(record)
                    if (!slug) return []
                    const pinnedVersion = embedRevisionVersion(record)
                    return [pinnedVersion ? {slug, pinnedVersion} : {slug}]
                }),
        [skills],
    )
    const handleAddSkillEmbeds = useCallback(
        (entries: Record<string, unknown>[]) => setAgentField("skills", [...skills, ...entries]),
        [setAgentField, skills],
    )
    const handleRemoveSkillEmbeds = useCallback(
        (slugs: string[]) => {
            const drop = new Set(slugs)
            setAgentField(
                "skills",
                skills.filter((entry) => {
                    if (!isEmbedRefSkill(entry)) return true
                    const slug = staticEmbedSlug(entry as Record<string, unknown>)
                    return !slug || !drop.has(slug)
                }),
            )
        },
        [setAgentField, skills],
    )

    // Controlled open-state for the list sections so the accordion can react to the agent
    // populating a section. Seeded once from the initial counts; the edge hook below flips it.
    const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>(() => ({
        tools: integrationCount > 0,
        subagents: subagentCount > 0,
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
            tools: integrationCount,
            subagents: subagentCount,
            mcp: mcpServers.length,
            skills: skills.length,
            triggers: triggerCount,
        }),
        [integrationCount, subagentCount, mcpServers.length, skills.length, triggerCount],
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
            // The schema's titles are English; in another language the translated label wins.
            if (getActiveLanguage() !== "en") return fallback
            const title = (props[field] as {title?: unknown} | undefined)?.title
            return typeof title === "string" && title.trim() && !title.startsWith("_")
                ? title
                : fallback
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
            revert: disabled
                ? undefined
                : (paths: string[]) =>
                      applyDraftConfig(revertPathsTo(draftConfig ?? config, committed, paths)),
        }),
        [sectionChanges.draft, applyDraftConfig, committed, draftConfig, config, disabled],
    )

    // Revert for the PANEL's own inline bodies: writes the entity draft straight through `onChange`,
    // matching how the panel's other inline sections (Tools, Instructions) already behave. Distinct
    // from `drawerChangedPaths` above — the drawer has a scoped draft to respect, the panel doesn't.
    const panelChangedPaths = useMemo(
        () => ({
            ...sectionChanges.draft,
            revert: disabled
                ? undefined
                : (paths: string[]) => onChange(revertPathsTo(config, committed, paths)),
        }),
        [sectionChanges.draft, onChange, config, committed, disabled],
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
            const sectionPaths = (section?.scalarChanges ?? [])
                .map((c) => c.key)
                .filter(
                    (path) =>
                        key !== "advanced" || (mh.hasExecutionGroup && path === "sandbox.kind"),
                )
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
            mh.hasExecutionGroup,
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
                    return {
                        tone: "invalid",
                        label: tNow("entityUi.agentTemplate.incomplete"),
                        tooltip: tNow(INVALID_ITEM_TIP[kind]),
                    }
                }
                if (!committed) return undefined
                const currentValue = stableStringify(stripAgentaMetadataDeep(item))
                if ([...baseMaps[kind].values()].includes(currentValue)) return undefined
                const prev = baseMaps[kind].get(agentItemIdentity(kind, item, index))
                if (prev === undefined)
                    return {
                        tone: "new",
                        label: tNow("entityUi.agentTemplate.new"),
                        tooltip: tNow("entityUi.agentTemplate.addedSinceLastVersion"),
                    }
                return {
                    tone: "edited",
                    label: tNow("entityUi.agentTemplate.edited"),
                    tooltip: tNow("entityUi.agentTemplate.editedNotSaved"),
                }
            },
        [committed, baseMaps],
    )

    // ── Connected-app tool resolution ─────────────────────────────────────────
    // Mirrors the tool drawer's fail-safe (a canonical gateway tool whose catalog action 404s
    // shows the raw-JSON warning) so the row is marked BEFORE the drawer is opened. The probe
    // reuses the drawer's query family (low-priority fetch, 5-min cache), and the connection
    // registry is already loaded by the provider — no extra render-critical requests.
    // Both kinds of gateway entry name a connection, so both get the connection checks below. Only
    // an action entry names an action, which is what the availability probe needs.
    const gatewayToolViews = useMemo(() => {
        const views = new Map<number, GatewayEntry>()
        tools.forEach((item, index) => {
            const entry = parseGatewayEntry(item)
            if (entry) views.set(index, entry)
        })
        return views
    }, [tools])
    const actionProbePairs = useMemo(
        () =>
            gatewayTools?.enabled
                ? [...gatewayToolViews.values()].flatMap((v) =>
                      v.kind === "action" && v.action.encoding === "canonical"
                          ? [{integrationKey: v.action.integration, actionKey: v.action.action}]
                          : [],
                  )
                : [],
        [gatewayToolViews, gatewayTools?.enabled],
    )
    const actionAvailability = useToolActionAvailability(actionProbePairs)
    const toolResolutionStatus = useCallback(
        (index: number): ItemRowStatus | undefined => {
            const entry = gatewayToolViews.get(index)
            if (!entry) return undefined
            if (
                entry.kind === "action" &&
                entry.action.encoding === "canonical" &&
                actionAvailability[
                    toolActionAvailabilityKey(entry.action.integration, entry.action.action)
                ] === "missing"
            ) {
                return {
                    tone: "invalid",
                    label: tNow("entityUi.agentTemplate.unresolved"),
                    tooltip: tNow("entityUi.agentTemplate.unresolvedTip"),
                }
            }
            // A missing, turned-off or signed-out connection is the server's needs-setup check.
            if (!requirements) return undefined
            const ref = entry.kind === "connection" ? entry.connection : entry.action
            const req = requirementForItem(requirements, {
                kinds: ["app_connection"],
                slug: ref.connection,
                integration: ref.integration,
            })
            return req ? needsSetupStatus(req) : undefined
        },
        [gatewayToolViews, actionAvailability, requirements],
    )
    // Section rollup counts for the header indicator/tooltips.
    const toolResolutionSummary = useMemo(() => {
        let unresolved = 0
        let needsSetup = 0
        for (const index of gatewayToolViews.keys()) {
            const s = toolResolutionStatus(index)
            if (s?.tone === "invalid") unresolved += 1
            else if (isNeedsSetupStatus(s)) needsSetup += 1
        }
        return {unresolved, needsSetup}
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
    // Registry head versions for the pinned-row nudge. The bridge's presence is host-stable,
    // so the conditional hook resolution keeps a stable hook order in practice.
    const useHeadVersions = skillsBridge?.useHeadVersions ?? useNoHeadVersions
    const skillHeadVersions = useHeadVersions()
    // Publish-to-registry for INLINE packages: the migration path off pre-registry
    // configs. The bridge creates the registry skill and answers with the embed entry
    // that replaces the inline one at the same index; auto-commit persists the swap.
    const [publishingSkillIndex, setPublishingSkillIndex] = useState<number | null>(null)
    const [publishSkillError, setPublishSkillError] = useState<string | null>(null)
    const publishInlineSkill = useCallback(
        // `item` is the row's identity in the config; `content` is what goes to the registry —
        // the drawer's draft, so an edit made before publishing is what gets published.
        async (item: unknown, index: number, content: unknown = item) => {
            const publish = skillsBridge?.publishInlineSkill
            if (!publish || publishingSkillIndex !== null) return
            setPublishingSkillIndex(index)
            setPublishSkillError(null)
            try {
                const outcome = await publish(content as Record<string, unknown>)
                if ("error" in outcome) {
                    setPublishSkillError(outcome.error)
                    return
                }
                const current = Array.isArray(configRef.current?.skills)
                    ? (configRef.current.skills as unknown[])
                    : skills
                // The list may have shifted during the await — swap by IDENTITY of the
                // published item, never by its captured index.
                const liveIndex = current.indexOf(item)
                if (liveIndex === -1) {
                    setPublishSkillError(tNow("entityUi.agentTemplate.publishedRowChanged"))
                    return
                }
                onChange({
                    ...(configRef.current ?? config),
                    skills: current.map((entry, i) => (i === liveIndex ? outcome.entry : entry)),
                })
                closeEditor()
            } finally {
                setPublishingSkillIndex(null)
            }
        },
        [closeEditor, config, configRef, onChange, publishingSkillIndex, skills, skillsBridge],
    )
    const skillStatusFor = useMemo(() => {
        const base = statusForKind("skill")
        return (item: unknown, index: number) => {
            const status = base(item, index)
            if (status) return status
            // Gold nudge on pinned embeds the registry has moved past.
            if (!isEmbedRefSkill(item) || isStaticSkill(item)) return undefined
            const record = item as Record<string, unknown>
            const pinned = embedRevisionVersion(record)
            if (!pinned) return undefined
            const slug = staticEmbedSlug(record)
            const head = slug ? skillHeadVersions[slug] : undefined
            if (!head || Number(pinned) >= Number(head)) return undefined
            return {
                tone: "incomplete" as const,
                label: tNow("entityUi.agentTemplate.updateAvailable"),
                tooltip: tNow("entityUi.agentTemplate.updateAvailableTip"),
            }
        }
    }, [statusForKind, skillHeadVersions])

    // Section headers: a blocking problem (invalid) outranks unsaved edits (draft).
    const sectionInvalidTip = (key: string): string | null => {
        if (key === "model-harness") {
            if (mh.hasModelOrHarness && !modelIdFromConfig(config.llm))
                return t("entityUi.agentTemplate.noModelSelected")
            return null
        }
        if (key === "subagents") {
            return subagentTools.some(({item}) =>
                ITEM_KINDS.tool.draftInvalid(item as Record<string, unknown>),
            )
                ? t("entityUi.agentTemplate.subagentMissingName")
                : null
        }
        if (key === "tools") {
            // Integration entries only: anything else has its own header or renders nowhere.
            const owned = new Set(integrationRows.flatMap(integrationRowIndices))
            if (
                tools.some(
                    (tool, i) =>
                        owned.has(i) &&
                        ITEM_KINDS.tool.draftInvalid(tool as Record<string, unknown>),
                )
            )
                return t("entityUi.agentTemplate.integrationMissingName")
            if (toolResolutionSummary.unresolved > 0)
                return t("entityUi.agentTemplate.toolUnresolved")
            return null
        }
        if (key === "mcp")
            return mcpServers.some((m) => ITEM_KINDS.mcp.draftInvalid(m as Record<string, unknown>))
                ? t("entityUi.agentTemplate.mcpMissingName")
                : null
        if (key === "skills")
            return skills.some((s) => ITEM_KINDS.skill.draftInvalid(s as Record<string, unknown>))
                ? t("entityUi.agentTemplate.aSkillMissingName")
                : null
        return null
    }
    // Structurally valid but missing setup the section needs to run (amber, ranks below invalid).
    const sectionIncompleteTip = (key: string): string | null => {
        if (key === "model-harness" && modelReq) return modelNeedsSetupMessage()
        if (key === "tools" && toolResolutionSummary.needsSetup > 0) return needsSetupLabel()
        if (key === "mcp" && mcpNeedsSetup) return needsSetupLabel()
        if (key === "advanced" && secretReq) return needsSetupLabel()
        return null
    }
    const headerIndicator = (
        key: string,
    ): {tone: "draft" | "invalid" | "incomplete"; tooltip?: string} | undefined => {
        const invalid = sectionInvalidTip(key)
        if (invalid !== null) return {tone: "invalid", tooltip: invalid}
        const incomplete = sectionIncompleteTip(key)
        if (incomplete !== null) return {tone: "incomplete", tooltip: incomplete}
        if (draftSectionKeys.has(key as PanelSectionKey))
            return {
                tone: "draft",
                tooltip: t(DRAFT_TIP[key] ?? "entityUi.agentTemplate.unsavedChanges"),
            }
        return undefined
    }
    // Final header indicator for a section: validation/draft state, falling back to the agent's
    // self-commit mark, with the cross-pane draft pulse layered on. One place so the drawers, the
    // marks, and the header can never disagree.
    const sectionIndicator = (key: string) =>
        withDraftPulse(key, headerIndicator(key) ?? agentChangeIndicator(key))

    // A tagged integration opens the drawer that picks or connects its account.
    const openIntegrationRow = useCallback(
        (row: IntegrationRow) => {
            if (integrationRowIndices(row).some((i) => isNeedsSetupStatus(toolResolutionStatus(i))))
                openAddIntegration()
            else openIntegrationPermissions(row)
        },
        [openAddIntegration, openIntegrationPermissions, toolResolutionStatus],
    )

    // "Add subagents" and a subagent row open views, as Integrations does.
    const openAddSubagents =
        workflowReference?.enabled && viewTarget
            ? () => void openView(subagentAddView, {}, viewTarget)
            : undefined
    const openSubagent = useCallback(
        (item: ConfigItemRef) => {
            if (viewTarget) void openView(subagentView, {item}, viewTarget)
        },
        [openView, viewTarget],
    )
    const removeSubagent = useCallback(
        (item: ConfigItemRef) => {
            const latest = configRef.current
            onChange({
                ...latest,
                tools: removeSubagentByRef(
                    Array.isArray(latest.tools) ? (latest.tools as unknown[]) : [],
                    item,
                ),
            })
        },
        [onChange],
    )
    // The Integrations add button: the agent's "Add integration" view, not the shared catalog.
    const addIntegration = gatewayTools?.enabled ? openAddIntegration : undefined

    // The inline "what changed" body for the drawer-backed Advanced section. Null when the section
    // is clean, which is what keeps it a plain drawer-opening row.
    const advancedChangeBody = changeBodyFor("advanced")

    // The props the Model and Permissions section bodies pass on: the live config.
    const bodyProps = {schema, config, onChange, disabled, withTooltip, revisionId}

    // Each config section as a descriptor, so it can be rendered in any layout (accordion /
    // tabs / cards) without duplicating the content. Schema-gated, like before. Each section's
    // header and body live in its own file under `agentTemplate/sections/`.
    const sections = [
        modelSection({
            t,
            mh,
            sectionIndicator,
            config,
            modelReq,
            openModel,
        }),
        instructionsSection({
            t,
            hasInstructions,
            fieldTitle,
            sectionIndicator,
            draftSectionKeys,
            agentsMd,
            openInstruction,
        }),
        integrationsSection({
            t,
            hasTools,
            sectionIndicator,
            disabled,
            openAddIntegration: addIntegration,
            integrationCount,
            tools,
            integrationRows,
            toolStatusFor,
            gatewayToolsEnabled: Boolean(gatewayTools?.enabled),
            openIntegrationRow,
            askRemoveIntegration: setRemovingIntegration,
        }),
        subagentsSection({
            t,
            hasTools,
            sectionIndicator,
            disabled,
            openAddSubagents,
            subagentCount,
            workflowReference,
            subagentTools,
            openSubagent,
            removeSubagent,
            toolStatusFor,
        }),
        agentMcpSection({
            t,
            hasMcp,
            fieldTitle,
            sectionIndicator,
            disabled,
            mcpServers,
            openAddMcp,
            openMcpServer,
            removeMcpServer,
            openForm: (index: number, item: unknown) => openEdit("mcp", index, item),
            mcpStatusFor,
        }),
        skillsSection({
            t,
            hasSkills,
            fieldTitle,
            sectionIndicator,
            disabled,
            skills,
            handleAddSkill,
            publishSkillError,
            openSkillItem,
            removeItem,
            closeEditor,
            skillStatusFor,
        }),
        permissionsSection({t, mh, sectionIndicator, panelChangedPaths, bodyProps}),
        advancedSection({
            t,
            mh,
            sectionIndicator,
            secretReq,
            advancedChangeBody,
            openSectionDrawer,
        }),
    ].filter(Boolean) as AgentTemplateSectionDescriptor[]

    // Keep the item + instruction drawers MOUNTED while they animate closed. Their editing state
    // goes null on close; retaining the last value and driving `open` off the live state lets the
    // exit transition play (an unmount-on-close drawer just vanishes). Matches the SectionDrawers.
    const lastEditingRef = useRef(editing)
    if (editing) lastEditingRef.current = editing
    const shownEditing = editing ?? lastEditingRef.current

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
                      // Skills state their identity in their own form, and an MCP server's title
                      // already says what it is; both drawers drop the badge and subtitle.
                      const bareChrome =
                          shownEditing.kind === "skill" || shownEditing.kind === "mcp"
                      // An inline skill's way into the registry, from the drawer's footer: the
                      // draft is what gets published, and the row it came from is what gets
                      // swapped for the reference.
                      const inlineSkillItem =
                          shownEditing.kind === "skill" && shownEditing.mode === "edit"
                              ? skills[shownEditing.index]
                              : undefined
                      const canPublish =
                          inlineSkillItem !== undefined &&
                          Boolean(skillsBridge?.publishInlineSkill) &&
                          !isEmbedRefSkill(inlineSkillItem) &&
                          !readOnly &&
                          !draftInvalid
                      const publishing = publishingSkillIndex !== null
                      // The publish sends the draft as it was pressed; an edit made meanwhile
                      // would be thrown away when the row is swapped for the reference.
                      const editorDisabled = readOnly || publishing
                      const publishAction = canPublish ? (
                          <TooltipProvider>
                              <Tooltip>
                                  <TooltipTrigger asChild>
                                      <Button
                                          variant="outline"
                                          disabled={publishing}
                                          onClick={() =>
                                              void publishInlineSkill(
                                                  inlineSkillItem,
                                                  shownEditing.index,
                                                  draft,
                                              )
                                          }
                                      >
                                          {publishing ? (
                                              <Spinner size="small" />
                                          ) : (
                                              <UploadSimple size={14} />
                                          )}
                                          {publishing
                                              ? t("entityUi.agentTemplate.publishing")
                                              : t("entityUi.agentTemplate.publishToRegistry")}
                                      </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                      {t("entityUi.agentTemplate.publishToRegistryHint")}
                                  </TooltipContent>
                              </Tooltip>
                          </TooltipProvider>
                      ) : undefined
                      return (
                          <ConfigItemDrawer
                              open={!!editing}
                              mode={shownEditing.mode}
                              title={def.drawerTitle(draft)}
                              badge={
                                  bareChrome
                                      ? undefined
                                      : {text: desc.typeLabel, color: desc.typeColor}
                              }
                              subtitle={bareChrome ? undefined : desc.subtitle}
                              // A skill's footer-left is its Publish action; the MCP drawer has
                              // no note; every other kind keeps it.
                              footerNote={
                                  shownEditing.kind === "skill"
                                      ? publishAction
                                      : shownEditing.kind === "mcp"
                                        ? undefined
                                        : t("entityUi.agentTemplate.changesApply")
                              }
                              error={commitError}
                              saving={committing}
                              width={def.drawerWidth?.(draft)}
                              contentFlush={Boolean(def.formFlush?.(draft))}
                              loadingBody={
                                  shownEditing.kind === "skill" ? <SkillFormSkeleton /> : undefined
                              }
                              onCancel={closeEditor}
                              onSave={commitDraft}
                              saveDisabled={
                                  draftInvalid ||
                                  draftUnchanged ||
                                  (def.jsonOnly(draft) && jsonInvalid)
                              }
                              jsonOnly={def.jsonOnly(draft)}
                              disabled={editorDisabled}
                              form={
                                  <Form
                                      key={`form-${itemKey}`}
                                      value={draft}
                                      onChange={(v) => setDraft(v)}
                                      disabled={editorDisabled}
                                      // Save is inert while the draft is invalid, so there is
                                      // no press to wait for: an edited draft that is missing
                                      // a required field says so in the fields.
                                      showMissing={!draftUnchanged && draftInvalid}
                                  />
                              }
                              json={
                                  <JsonObjectEditor
                                      key={`json-${itemKey}`}
                                      value={draft}
                                      onChange={(v) => setDraft(v as Record<string, unknown>)}
                                      onValidityChange={(valid) => setJsonInvalid(!valid)}
                                      disabled={editorDisabled}
                                  />
                              }
                          />
                      )
                  })()
                : null}

            <SectionDrawer
                open={openSection === "advanced"}
                title={t("entityUi.agentTemplate.advanced")}
                onCancel={cancelSection}
                onSave={saveSection}
                disabled={disabled || !sectionDirty}
                dirty={sectionDirty}
                width={mh.advancedDrawerWidth}
                // No top or bottom gutter: the rail and its divider run header to footer.
                bodyPadding="0 12px"
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
                        credentialOperationsBlocked={sectionDirty}
                        onCredentialRevisionCommitted={rebaseSectionOnCredentialCommit}
                    />
                </ChangedPathsProvider>
            </SectionDrawer>

            {skillsBridge?.enabled ? (
                <skillsBridge.PickerHost
                    open={skillPickerOpen}
                    onClose={() => setSkillPickerOpen(false)}
                    added={addedSkillRefs}
                    onAdd={handleAddSkillEmbeds}
                    onRemove={handleRemoveSkillEmbeds}
                />
            ) : null}
            {skillsBridge?.DetailHost ? (
                <skillsBridge.DetailHost
                    open={skillDetailSlug !== null}
                    onClose={() => setSkillDetailSlug(null)}
                    slug={skillDetailSlug}
                />
            ) : null}

            {/* A view in this drawer follows the revision on screen and the edit right. */}
            <AgentEditorContext.Provider value={editor}>{views.drawer}</AgentEditorContext.Provider>
            {removingIntegration ? (
                <IntegrationRemoveDialog
                    row={removingIntegration}
                    onRemove={() => {
                        const latest = configRef.current
                        onChange({
                            ...latest,
                            tools: removeIntegrationByRef(
                                Array.isArray(latest.tools) ? (latest.tools as unknown[]) : [],
                                integrationItemRef(removingIntegration),
                            ),
                        })
                        setRemovingIntegration(null)
                    }}
                    onClose={() => setRemovingIntegration(null)}
                />
            ) : null}
        </div>
    )
})
