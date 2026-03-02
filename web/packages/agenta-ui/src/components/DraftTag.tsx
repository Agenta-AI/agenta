/**
 * DraftTag Component
 *
 * A reusable presentational component for displaying a "Draft" tag
 * with consistent styling across the application.
 */

import React from "react"

import {PencilSimpleLine} from "@phosphor-icons/react"
import {Tag} from "antd"
import type {TagProps} from "antd"

import {cn} from "../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

export interface DraftTagProps extends Omit<TagProps, "children"> {
    /** Optional custom label (defaults to "Draft") */
    label?: string
    /** Whether to show the pencil icon (defaults to true) */
    showIcon?: boolean
    /** Icon size in pixels (defaults to 14) */
    iconSize?: number
}

// ============================================================================
// COMPONENT
// ============================================================================

export function DraftTag({
    label = "Draft",
    showIcon = true,
    iconSize = 14,
    className,
    ...tagProps
}: DraftTagProps) {
    return (
        <Tag
            className={cn(
                "flex items-center gap-1 font-normal bg-[#586673] text-white !m-0",
                className,
            )}
            {...tagProps}
        >
            {showIcon && <PencilSimpleLine size={iconSize} />}
            {label}
        </Tag>
    )
}

export default DraftTag
