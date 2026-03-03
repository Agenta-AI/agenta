/**
 * BaseRunnableConfigSection
 *
 * Configuration viewer/editor for baseRunnable entities (trace replays).
 * Delegates config rendering to LegacyPlaygroundConfigSection via a
 * molecule adapter that bridges baseRunnableMolecule's API.
 */

import {memo, useCallback, useMemo} from "react"

import {baseRunnableMolecule} from "@agenta/entities/baseRunnable"
import {PlaygroundConfigSection, type ConfigSectionMoleculeAdapter} from "@agenta/entity-ui"
import {message} from "@agenta/ui/app-message"
import {DraftTag} from "@agenta/ui/components"
import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, Typography} from "antd"
import type {MenuProps} from "antd"
import type {Atom, WritableAtom} from "jotai"
import {atom} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

// ============================================================================
// BRIDGE UPDATE REDUCER
// ============================================================================

/**
 * Bridge update reducer that translates LegacyPlaygroundConfigSection's
 * update format ({parameters: {...}}) to baseRunnableMolecule's format
 * (flat parameter keys).
 *
 * LegacyPlaygroundConfigSection calls:
 *   update(id, { parameters: { prompt: {...}, ... } })
 *
 * baseRunnableMolecule.reducers.update expects:
 *   update(id, { prompt: {...}, ... })
 *
 * This bridge unwraps the `parameters` wrapper.
 */
const bridgeUpdateAtom: WritableAtom<
    unknown,
    [id: string, changes: Record<string, unknown>],
    void
> = atom(null, (_get, set, id: string, changes: Record<string, unknown>) => {
    // Unwrap {parameters: {...}} → flat parameters
    const params =
        changes.parameters && typeof changes.parameters === "object"
            ? (changes.parameters as Record<string, unknown>)
            : changes
    set(baseRunnableMolecule.reducers.update, id, params)
})

// ============================================================================
// DATA WRAPPER ATOMS
// ============================================================================

/**
 * Atom family that wraps baseRunnableMolecule's merged data as
 * {parameters: {...}} to match the shape LegacyPlaygroundConfigSection expects.
 */
function wrappedDataAtom(id: string): Atom<{parameters?: Record<string, unknown>} | null> {
    return baseRunnableMolecule.selectors.data(id) as Atom<{
        parameters?: Record<string, unknown>
    } | null>
}

/**
 * Atom family that wraps baseRunnableMolecule's base (pre-draft) data.
 */
function wrappedBaseDataAtom(id: string): Atom<{parameters?: Record<string, unknown>} | null> {
    return atom((get) => {
        const params = get(baseRunnableMolecule.atoms.serverData(id))
        if (!params) return null
        // Wrap parameters into {parameters: ...} shape
        return {parameters: params as Record<string, unknown>}
    })
}

// ============================================================================
// MOLECULE ADAPTER
// ============================================================================

const baseRunnableConfigAdapter: ConfigSectionMoleculeAdapter = {
    atoms: {
        data: wrappedDataAtom,
        serverData: wrappedBaseDataAtom,
        draft: baseRunnableMolecule.atoms.draft,
        isDirty: baseRunnableMolecule.atoms.isDirty,
        schemaQuery: baseRunnableMolecule.atoms
            .schemaQuery as ConfigSectionMoleculeAdapter["atoms"]["schemaQuery"],
        agConfigSchema: baseRunnableMolecule.atoms.agConfigSchema as (
            id: string,
        ) => Atom<{properties?: Record<string, unknown>} | null>,
    },
    reducers: {
        update: bridgeUpdateAtom,
        discard: baseRunnableMolecule.reducers.discard,
    },
    drillIn: {
        ...baseRunnableMolecule.drillIn,
        // Override getRootData to extract .parameters from the wrapped entity
        getRootData: (entity: unknown) => {
            if (!entity || typeof entity !== "object") return null
            const e = entity as {parameters?: Record<string, unknown>}
            return e.parameters ?? entity
        },
        // Override getChangesFromRoot to wrap back into {parameters: ...}
        getChangesFromRoot: (_entity: unknown, rootData: unknown, _path: (string | number)[]) => {
            if (!rootData || typeof rootData !== "object") return null
            return {parameters: rootData as Record<string, unknown>}
        },
    },
    selectors: {
        schemaAtPath: (params) =>
            baseRunnableMolecule.selectors.schemaAtPath(params) as Atom<unknown>,
    },
    set: {
        update: (id: string, changes: Record<string, unknown>) => {
            const store = getDefaultStore()
            store.set(bridgeUpdateAtom, id, changes)
        },
    },
}

// ============================================================================
// COMPONENT
// ============================================================================

interface BaseRunnableConfigSectionProps {
    entityId: string
}

function BaseRunnableConfigSection({entityId}: BaseRunnableConfigSectionProps) {
    const data = useAtomValue(
        useMemo(() => baseRunnableMolecule.selectors.data(entityId), [entityId]),
    )
    const isDirty = useAtomValue(
        useMemo(() => baseRunnableMolecule.selectors.isDirty(entityId), [entityId]),
    )

    const hasParameters = data?.parameters && Object.keys(data.parameters).length > 0

    const posthog = usePostHogAg()

    const discardEntity = useSetAtom(baseRunnableMolecule.reducers.discard)
    const handleDiscard = useCallback(() => {
        discardEntity(entityId)
    }, [entityId, discardEntity])

    const handleCreateApp = useCallback(() => {
        posthog?.capture?.("create_from_span_clicked", {
            type: "app",
            entityId,
            hasParameters: !!data?.parameters && Object.keys(data.parameters).length > 0,
            sourceLabel: data?.label,
        })
        message.info("Create App from span - coming soon")
    }, [posthog, entityId, data?.parameters, data?.label])

    const handleCreateEvaluator = useCallback(() => {
        posthog?.capture?.("create_from_span_clicked", {
            type: "evaluator",
            entityId,
            hasParameters: !!data?.parameters && Object.keys(data.parameters).length > 0,
            sourceLabel: data?.label,
        })
        message.info("Create Evaluator from span - coming soon")
    }, [posthog, entityId, data?.parameters, data?.label])

    const createMenuItems: MenuProps["items"] = useMemo(
        () => [
            {
                key: "app",
                label: "Create App",
                onClick: handleCreateApp,
            },
            {
                key: "evaluator",
                label: "Create Evaluator",
                onClick: handleCreateEvaluator,
            },
        ],
        [handleCreateApp, handleCreateEvaluator],
    )

    return (
        <>
            <section className="flex items-center justify-between h-[48px] px-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <Typography.Text strong>{data?.label ?? "Trace Replay"}</Typography.Text>
                    {isDirty && <DraftTag />}
                </div>
                <div className="flex items-center gap-2">
                    {isDirty && (
                        <Tooltip title="Discard changes">
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<Trash size={16} />}
                                onClick={handleDiscard}
                            />
                        </Tooltip>
                    )}
                    <Dropdown menu={{items: createMenuItems}} trigger={["click"]}>
                        <Button type="primary" size="small" icon={<Plus size={14} />}>
                            Create
                        </Button>
                    </Dropdown>
                </div>
            </section>
            {hasParameters ? (
                <PlaygroundConfigSection
                    revisionId={entityId}
                    moleculeAdapter={baseRunnableConfigAdapter}
                />
            ) : (
                <div className="px-3 py-4 text-[rgba(0,0,0,0.45)] text-sm">
                    No configuration parameters
                </div>
            )}
        </>
    )
}

export default memo(BaseRunnableConfigSection)
