/**
 * DownstreamMappingsSection Component
 *
 * Displays input mappings for downstream nodes showing:
 * - Source connection info (which upstream node feeds into this one)
 * - Input mappings with source indicators (from testcase or from upstream output)
 * - Object input mappings with nested key mappings
 * - Configure/Edit mappings button
 */

import {useMemo} from "react"

import {
    useRunnable,
    type RunnableType,
    type TestsetColumn,
    type InputMapping,
} from "@agenta/entities/runnable"
import {cn, entityIconColors, statusColors, textColors} from "@agenta/ui"
import {ArrowRight, Lightning, MagicWand, Table, X} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"

import type {EntitySelection} from "../../EntitySelector"

const {Text} = Typography

export interface DownstreamMappingsSectionProps {
    /** The selected entity */
    entity: EntitySelection
    /** Expected input columns (from runnable's schema) - passed from parent or empty for downstream */
    columns: TestsetColumn[]
    /** Input mappings for downstream nodes (shows where inputs come from) */
    incomingMappings?: InputMapping[]
    /** Source entity label for downstream nodes */
    sourceEntityLabel?: string
    /** Callback to open the mapping editor */
    onEditMappings?: () => void
}

export function DownstreamMappingsSection({
    entity,
    columns,
    incomingMappings = [],
    sourceEntityLabel,
    onEditMappings,
}: DownstreamMappingsSectionProps) {
    const type = entity.type as RunnableType
    const runnable = useRunnable(type, entity.id)

    // For downstream nodes (when columns prop is empty), derive columns from runnable.inputs
    const effectiveColumns: TestsetColumn[] = useMemo(
        () =>
            columns.length > 0
                ? columns
                : runnable.inputs.map((input) => ({
                      key: input.key,
                      name: input.name || input.key,
                      type: (input.type as TestsetColumn["type"]) || "string",
                      required: input.required,
                  })),
        [columns, runnable.inputs],
    )

    return (
        <div className="px-3 py-2">
            {/* Source connection info */}
            {sourceEntityLabel && (
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                    <Text type="secondary" className="text-xs">
                        Receives output from
                    </Text>
                    <Lightning size={12} weight="fill" className={entityIconColors.primary} />
                    <Text strong className="text-xs">
                        {sourceEntityLabel}
                    </Text>
                    <ArrowRight size={12} className={textColors.quaternary} />
                    <Text type="secondary" className="text-xs">
                        this
                    </Text>
                </div>
            )}

            <div className="flex items-center justify-between mb-2">
                <Text type="secondary" className="text-xs uppercase tracking-wide">
                    Input Mappings
                </Text>
                {/* Only show Edit button when there are mappings configured */}
                {onEditMappings && incomingMappings.length > 0 && (
                    <Button
                        type="link"
                        size="small"
                        onClick={onEditMappings}
                        className="p-0 h-auto"
                    >
                        Edit
                    </Button>
                )}
            </div>

            {incomingMappings.length > 0 ? (
                <div className="space-y-1.5">
                    {effectiveColumns.map((col) => {
                        // Check if this is an object-type input with key mappings
                        const objectMappings = incomingMappings.filter(
                            (m) => m.targetInputKey === col.key && m.keyInObject,
                        )
                        const isObjectInput = col.type === "object" || objectMappings.length > 0

                        if (isObjectInput) {
                            // Render object input with its key mappings
                            return (
                                <div
                                    key={col.key}
                                    className="border border-gray-100 rounded bg-gray-50/50 p-1.5"
                                >
                                    {/* Object header */}
                                    <div className="flex items-center gap-2 text-sm mb-1">
                                        <span className={cn("font-medium", textColors.primary)}>
                                            {col.name}
                                        </span>
                                        <Text type="secondary" className="text-xs">
                                            dict · {objectMappings.length} key
                                            {objectMappings.length !== 1 ? "s" : ""}
                                        </Text>
                                    </div>
                                    {/* Key mappings */}
                                    {objectMappings.length > 0 ? (
                                        <div className="ml-4 space-y-0.5">
                                            {objectMappings.map((objMapping) => {
                                                const sourcePath = objMapping.sourcePath || []
                                                const sourcePathArr = Array.isArray(sourcePath)
                                                    ? sourcePath
                                                    : [sourcePath]
                                                const isFromTestcase =
                                                    sourcePathArr[0] === "testcase"
                                                const sourceDisplay = isFromTestcase
                                                    ? sourcePathArr[1] || "—"
                                                    : sourcePathArr.join(".") || "—"

                                                return (
                                                    <div
                                                        key={`${col.key}-${objMapping.keyInObject}`}
                                                        className="flex items-center gap-1.5 text-xs"
                                                    >
                                                        {isFromTestcase ? (
                                                            <Table
                                                                size={10}
                                                                className={cn(
                                                                    statusColors.successIcon,
                                                                    "flex-shrink-0",
                                                                )}
                                                            />
                                                        ) : (
                                                            <Lightning
                                                                size={10}
                                                                className={cn(
                                                                    entityIconColors.primary,
                                                                    "flex-shrink-0",
                                                                )}
                                                            />
                                                        )}
                                                        <span
                                                            className={cn(
                                                                "truncate",
                                                                textColors.secondary,
                                                            )}
                                                        >
                                                            {sourceDisplay}
                                                        </span>
                                                        <ArrowRight
                                                            size={10}
                                                            className={cn(
                                                                textColors.quaternary,
                                                                "flex-shrink-0",
                                                            )}
                                                        />
                                                        <span
                                                            className={cn(
                                                                "font-mono",
                                                                textColors.secondary,
                                                            )}
                                                        >
                                                            .{objMapping.keyInObject}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <Text type="secondary" className="text-xs ml-4">
                                            No keys mapped
                                        </Text>
                                    )}
                                </div>
                            )
                        }

                        // Scalar mapping (original logic)
                        const mapping = incomingMappings.find(
                            (m) => m.targetInputKey === col.key && !m.keyInObject,
                        )
                        const sourcePath = mapping?.sourcePath || []
                        const sourcePathArr = Array.isArray(sourcePath) ? sourcePath : [sourcePath]
                        const isFromTestcase = sourcePathArr[0] === "testcase"
                        const sourceDisplay = isFromTestcase
                            ? sourcePathArr[1] || "—"
                            : sourcePathArr.join(".") || "—"
                        const isAutoMapped = mapping?.isAutoMapped
                        const isMissing = !mapping || mapping.status === "missing_source"

                        return (
                            <div
                                key={col.key}
                                className="border border-gray-100 rounded bg-gray-50/50 p-1.5"
                            >
                                {/* Section header - matches object input style */}
                                <div className="flex items-center gap-2 text-sm mb-1">
                                    <span className={cn("font-medium", textColors.primary)}>
                                        {col.name}
                                    </span>
                                </div>
                                {/* Mapping row */}
                                <div className="ml-4 flex items-center gap-1.5 text-xs">
                                    {isMissing ? (
                                        <X
                                            size={10}
                                            className={cn(statusColors.error, "flex-shrink-0")}
                                        />
                                    ) : isFromTestcase ? (
                                        <Table
                                            size={10}
                                            className={cn(
                                                statusColors.successIcon,
                                                "flex-shrink-0",
                                            )}
                                        />
                                    ) : (
                                        <Lightning
                                            size={10}
                                            className={cn(
                                                entityIconColors.primary,
                                                "flex-shrink-0",
                                            )}
                                        />
                                    )}
                                    <span
                                        className={cn(
                                            "truncate",
                                            isMissing
                                                ? cn(statusColors.error, "italic")
                                                : textColors.secondary,
                                        )}
                                    >
                                        {isMissing ? "Not mapped" : sourceDisplay}
                                    </span>
                                    {!isMissing && (
                                        <Tooltip
                                            title={isAutoMapped ? "Auto-mapped" : "Manually mapped"}
                                        >
                                            {isAutoMapped ? (
                                                <MagicWand
                                                    size={10}
                                                    className={cn(
                                                        entityIconColors.primary,
                                                        "flex-shrink-0",
                                                    )}
                                                />
                                            ) : (
                                                <Tag
                                                    color="green"
                                                    className="m-0 text-[10px] leading-tight py-0 px-1"
                                                >
                                                    M
                                                </Tag>
                                            )}
                                        </Tooltip>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                    {/* Show source info */}
                    {sourceEntityLabel && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                            <Text type="secondary" className="text-xs">
                                <Lightning
                                    size={10}
                                    className={cn(entityIconColors.primary, "inline mr-1")}
                                />
                                = from {sourceEntityLabel} output
                                <span className="mx-2">|</span>
                                <Table
                                    size={10}
                                    className={cn(statusColors.successIcon, "inline mr-1")}
                                />
                                = from testcase
                            </Text>
                        </div>
                    )}
                </div>
            ) : effectiveColumns.length === 0 ? (
                <Text type="secondary" className="text-xs">
                    No inputs required
                </Text>
            ) : (
                <div className="text-center py-2">
                    <Text type="secondary" className="text-xs">
                        No mappings configured yet
                    </Text>
                    {onEditMappings && (
                        <div className="mt-1">
                            <Button type="dashed" size="small" onClick={onEditMappings}>
                                Configure Mappings
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
