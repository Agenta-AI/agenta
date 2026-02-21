import React, {memo, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {RunnablePort} from "@agenta/entities/runnable"
import {RunnableOutputValue} from "@agenta/entity-ui"
import clsx from "clsx"

import {buildSchemaMap, formatFieldLabel} from "./utils"

// ============================================================================
// SKELETON HELPERS
// ============================================================================

/** Map port schema type to a Tailwind width class for the skeleton placeholder */
function getSkeletonWidth(port: RunnablePort): string {
    const type = port.type?.toLowerCase()
    switch (type) {
        case "boolean":
            return "w-10"
        case "number":
        case "integer":
            return "w-16"
        case "string":
            return "w-32"
        case "object":
        case "array":
            return "w-full"
        default:
            return "w-24"
    }
}

const FieldSkeleton = memo(({port}: {port: RunnablePort}) => (
    <div
        className={clsx(
            "h-4 rounded bg-[rgba(5,23,41,0.06)] animate-pulse",
            getSkeletonWidth(port),
        )}
    />
))
FieldSkeleton.displayName = "FieldSkeleton"

// ============================================================================
// COMPONENT
// ============================================================================

export interface EvaluatorFieldGridProps {
    /**
     * Display entries: [fieldKey, value] pairs.
     * When null and loading is true, outputPorts provide skeleton structure.
     */
    entries: [string, unknown][] | null
    /** Output ports for field structure (skeletons) and per-field schema (rendering) */
    outputPorts: RunnablePort[]
    /** When true, shows skeleton placeholders instead of values */
    loading?: boolean
    /** When true, shows field labels with em-dash placeholders (pre-run state) */
    idle?: boolean
    /** Additional className for the outer grid container */
    className?: string
    /**
     * Optional feedback configuration from the evaluator entity.
     * When provided, enriches the score field schema with range/enum constraints
     * for more informative rendering (e.g., "7.5 / 10" for continuous scores).
     */
    feedbackConfig?: Record<string, unknown> | null
}

/**
 * Shared evaluator field grid component.
 *
 * Renders a two-column grid of field labels and values:
 * - In loading mode: field labels from outputPorts + type-aware skeleton placeholders
 * - In value mode: field labels + schema-aware RunnableOutputValue per entry
 *
 * Returns null when there is nothing to render (no entries, not loading, or no ports).
 */
const EvaluatorFieldGrid = memo(function EvaluatorFieldGrid({
    entries,
    outputPorts,
    loading,
    idle,
    className,
    feedbackConfig,
}: EvaluatorFieldGridProps) {
    const schemaMap = useMemo(() => {
        const base = buildSchemaMap(outputPorts)

        // Enrich the "score" field schema with constraints from feedback_config
        if (feedbackConfig) {
            const jsonSchema = feedbackConfig.json_schema as
                | {schema?: {properties?: {score?: Record<string, unknown>}}}
                | undefined
            const scoreConstraints = jsonSchema?.schema?.properties?.score
            if (scoreConstraints) {
                const existing = base.score ?? ({} as Record<string, unknown>)
                base.score = {...existing, ...scoreConstraints} as SchemaProperty
            }
        }

        return base
    }, [outputPorts, feedbackConfig])

    // Loading mode: render field labels from outputPorts + skeletons
    if (loading) {
        if (outputPorts.length === 0) {
            return (
                <div className={clsx("flex items-center gap-2", className)}>
                    <div className="h-4 w-24 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                </div>
            )
        }

        return (
            <div
                className={clsx("grid items-baseline text-xs leading-5", className)}
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4}}
            >
                {outputPorts.map((port) => (
                    <React.Fragment key={port.key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                            {formatFieldLabel(port.key)}:
                        </span>
                        <FieldSkeleton port={port} />
                    </React.Fragment>
                ))}
            </div>
        )
    }

    // Idle mode: render field labels with em-dash placeholders (pre-run state)
    if (idle && outputPorts.length > 0) {
        return (
            <div
                className={clsx("grid items-baseline text-xs leading-5", className)}
                style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4}}
            >
                {outputPorts.map((port) => (
                    <React.Fragment key={port.key}>
                        <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                            {formatFieldLabel(port.key)}:
                        </span>
                        <span className="text-[var(--ant-color-text-quaternary)] leading-5">—</span>
                    </React.Fragment>
                ))}
            </div>
        )
    }

    // Value mode: render actual entries
    if (!entries || entries.length === 0) return null

    return (
        <div
            className={clsx("grid items-baseline text-xs leading-5", className)}
            style={{gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4}}
        >
            {entries.map(([key, value]) => (
                <React.Fragment key={key}>
                    <span className="text-[var(--ant-color-text-tertiary)] whitespace-nowrap leading-5">
                        {formatFieldLabel(key)}:
                    </span>
                    <span className="break-words min-w-0 leading-5">
                        <RunnableOutputValue value={value} schema={schemaMap[key]} />
                    </span>
                </React.Fragment>
            ))}
        </div>
    )
})

export default EvaluatorFieldGrid
export {EvaluatorFieldGrid}
