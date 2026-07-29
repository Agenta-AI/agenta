/**
 * Types owned by PlaygroundConfigSection: the molecule adapter contract, the
 * public component props, and the internal schema / tab / fallback-detail shapes.
 */

import type React from "react"

import type {EntitySchema, EntitySchemaProperty} from "@agenta/entities/shared"
import type {DataPath} from "@agenta/shared/utils"
import type {Atom, WritableAtom} from "jotai"

export interface SchemaQueryResult {
    isPending: boolean
    isError: boolean
    error: Error | null
    data: {agConfigSchema?: PathSchema | null} | null
}

export type PathSchema = EntitySchema | EntitySchemaProperty
export type ConfigureTabKey = "model" | "fallback" | "retry"
export interface FallbackDetailState {
    mode: "new" | "edit"
    index: number | null
    draft: Record<string, unknown>
}

/**
 * Adapter interface for the data source that PlaygroundConfigSection reads from.
 * Defaults to workflowMolecule when not provided.
 */
export interface ConfigSectionMoleculeAdapter {
    atoms: {
        /** Entity data with `.parameters` — used for hasParameters checks and popover data */
        data: (id: string) => Atom<{parameters?: Record<string, unknown>} | null>
        /** Base data (pre-draft) with `.parameters` */
        serverData: (id: string) => Atom<{parameters?: Record<string, unknown>} | null>
        /** Draft data */
        draft: (id: string) => Atom<unknown>
        /** Whether entity has local changes */
        isDirty: (id: string) => Atom<boolean>
        /** Schema query state */
        schemaQuery: (id: string) => Atom<SchemaQueryResult>
        /** ag_config schema */
        agConfigSchema: (id: string) => Atom<PathSchema | null>
    }
    reducers: {
        update: WritableAtom<unknown, [id: string, changes: Record<string, unknown>], void>
        discard: WritableAtom<unknown, [id: string], void>
    }
    drillIn: {
        getRootData?: (data: unknown) => unknown
        getChangesFromRoot?: (data: unknown, rootData: unknown, path: DataPath) => unknown
        getValueAtPath?: (data: unknown, path: DataPath) => unknown
        getRootItems?: (data: unknown) => unknown[]
        getChangesFromPath?: (data: unknown, path: DataPath, value: unknown) => unknown
        valueMode?: "native" | "structured"
    }
    selectors: {
        schemaAtPath: (params: {id: string; path: (string | number)[]}) => Atom<unknown>
    }
    /** @deprecated Use useSetAtom(mol.reducers.update) instead */
    set?: {
        update: (id: string, changes: Record<string, unknown>) => void
    }
}

/** Evaluator preset definition */
export interface EvaluatorPresetConfig {
    key: string
    name: string
    values: Record<string, unknown>
}

export type ConfigViewMode = "form" | "json" | "yaml"

export interface PlaygroundConfigSectionProps {
    revisionId: string
    disabled?: boolean
    useServerData?: boolean
    className?: string
    /** Optional molecule adapter — defaults to workflowMolecule */
    moleculeAdapter?: ConfigSectionMoleculeAdapter
    /** Called when the user clicks "Refine prompt with AI" on a prompt section header */
    onRefinePrompt?: (promptKey: string) => void
    /** View mode controlled from parent (form/json/yaml) */
    viewMode?: ConfigViewMode
    /**
     * Top offset (px) for the sticky section headers. Defaults to 48 to clear
     * the sticky `PlaygroundVariantConfigHeader` (h-[48px], `sticky top-0`) that
     * sits above the config in the full playground. In the embedded drawer that
     * header is rendered non-sticky (`grow`), so there is nothing to clear —
     * pass 0 there to keep the section headers flush with the scroll top instead
     * of floating 48px down into the editor content.
     */
    stickyHeaderTop?: number
    /**
     * Rendered instead of the generic pulse boxes while the config/schema is
     * loading. Lets the caller show a layout-matched skeleton (e.g. the agent
     * section-row list) when it knows the entity's shape before the data lands.
     */
    loadingFallback?: React.ReactNode
}
