import React from "react"

import {Tag} from "antd"
import clsx from "clsx"

// ============================================================================
// STATUS TYPES
// ============================================================================

export type NodeStatus =
    | "idle"
    | "running"
    | "pending"
    | "success"
    | "error"
    | "cancelled"
    | "skipped"

// ============================================================================
// NODE NAME TAG
// ============================================================================

export const NodeNameTag = ({
    name,
    version,
    isDraft,
}: {
    name: string
    version?: number | null
    isDraft?: boolean
}) => (
    <div className="flex items-center gap-1">
        <Tag
            variant="filled"
            className="!m-0 rounded-[6px] px-2 py-[1px] text-xs leading-[22px] bg-[var(--ag-c-0517290F)] text-[var(--ag-c-344054)] border border-solid border-transparent"
        >
            {name}
            {version != null && <span className="text-[var(--ag-c-667085)] ml-1">v{version}</span>}
        </Tag>
        {isDraft && (
            <Tag
                variant="filled"
                className="!m-0 rounded-[6px] px-1.5 py-[1px] text-[12px] leading-[22px] bg-[var(--ag-c-FFF7E6)] text-[var(--ag-c-D4760A)] border border-solid border-[var(--ag-c-FFE4B5)]"
            >
                draft
            </Tag>
        )}
    </div>
)

// ============================================================================
// NODE RESULT CARD
// ============================================================================

const BORDER_WIDTH = 1.5
const BORDER_RADIUS = 8
const RUNNING_BORDER_EFFECT_ENABLED = false

/**
 * A bordered card container for node execution results.
 *
 * The node name appears as a legend-style label on the top border.
 * Border color and animation can change based on execution status:
 * - idle/cancelled/success: neutral border
 * - running/pending: optional soft accent pulse on the border (currently disabled)
 * - error: red border
 */
export const NodeResultCard = ({
    name,
    version,
    isDraft,
    status = "idle",
    children,
    className,
    headerActions,
}: {
    name: string
    version?: number | null
    isDraft?: boolean
    status?: NodeStatus
    children: React.ReactNode
    className?: string
    /** Optional actions rendered next to the name tag in the legend area */
    headerActions?: React.ReactNode
}) => {
    const isRunning = status === "running" || status === "pending"
    const shouldShowRunningBorderEffect = isRunning && RUNNING_BORDER_EFFECT_ENABLED
    const isError = status === "error"
    const isSkipped = status === "skipped"

    // Both states share the same outer wrapper so spacing is identical.
    // The legend label always sits at the top of this wrapper (top: 0, left: 10),
    // and the card body starts at pt-[11px] beneath it.
    const LEGEND_HEIGHT = 11

    if (shouldShowRunningBorderEffect) {
        return (
            <div
                className={clsx("node-result-card relative group/item", className)}
                style={{paddingTop: LEGEND_HEIGHT}}
            >
                <div
                    className="absolute bg-[var(--ag-c-FFFFFF)] px-1 z-[2] flex items-center gap-1"
                    style={{top: 0, left: 10}}
                >
                    <NodeNameTag name={name} version={version} isDraft={isDraft} />
                    {headerActions ? (
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                            {headerActions}
                        </div>
                    ) : null}
                </div>
                <div
                    className="node-result-card--running relative overflow-hidden"
                    style={{
                        borderRadius: BORDER_RADIUS,
                        padding: BORDER_WIDTH,
                    }}
                >
                    <div
                        className="node-result-card__gradient absolute inset-0 pointer-events-none"
                        style={{borderRadius: BORDER_RADIUS}}
                    />
                    <div
                        className="relative bg-[var(--ag-c-FFFFFF)] px-3 pb-2 pt-6"
                        style={{
                            borderRadius: BORDER_RADIUS - BORDER_WIDTH,
                        }}
                    >
                        {children}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div
            className={clsx("node-result-card relative group/item", className)}
            style={{paddingTop: LEGEND_HEIGHT}}
        >
            <div
                className="absolute bg-[var(--ag-c-FFFFFF)] px-1 z-[1] flex items-center gap-1"
                style={{top: 0, left: 10}}
            >
                <NodeNameTag name={name} version={version} isDraft={isDraft} />
                {headerActions ? (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                        {headerActions}
                    </div>
                ) : null}
            </div>
            <div
                className={clsx(
                    "rounded-lg px-3 pt-6 pb-2 border border-solid",
                    isError
                        ? "border-[var(--ant-color-error)]"
                        : isSkipped
                          ? "border-[var(--ant-color-warning)] border-dashed"
                          : "border-[var(--ant-color-border-secondary)]",
                )}
            >
                {children}
            </div>
        </div>
    )
}

// ============================================================================
// KEYFRAME & STYLE INJECTION (runs once per page)
// ============================================================================

let keyframesInjected = false

/**
 * Injects the CSS for the running-node border: a single soft pulse in the brand accent (flat
 * fill, no gradient). Motion is opacity only, and it holds still under reduced-motion.
 */
export function ensureNodeCardKeyframes() {
    if (typeof window === "undefined" || keyframesInjected) return
    keyframesInjected = true

    const style = document.createElement("style")
    style.setAttribute("data-node-card", "")
    style.textContent = `
        @keyframes nodeCardPulse {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 1; }
        }

        .node-result-card__gradient {
            background: #D1D151;
            animation: nodeCardPulse 1.8s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
            .node-result-card__gradient {
                animation: none;
                opacity: 0.7;
            }
        }
    `
    document.head.appendChild(style)
}
