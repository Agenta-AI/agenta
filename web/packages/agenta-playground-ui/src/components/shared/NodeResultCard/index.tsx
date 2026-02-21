import React from "react"

import {Tag} from "antd"
import clsx from "clsx"

// ============================================================================
// STATUS TYPES
// ============================================================================

export type NodeStatus = "idle" | "running" | "pending" | "success" | "error" | "cancelled"

// ============================================================================
// NODE NAME TAG
// ============================================================================

export const NodeNameTag = ({name}: {name: string}) => (
    <Tag
        variant="filled"
        className="!m-0 rounded-[6px] px-2 py-[1px] text-xs leading-[22px] bg-[#0517290F] text-[#344054] border border-solid border-transparent"
    >
        {name}
    </Tag>
)

// ============================================================================
// NODE RESULT CARD
// ============================================================================

const BORDER_WIDTH = 1.5
const BORDER_RADIUS = 8

/**
 * A bordered card container for node execution results.
 *
 * The node name appears as a legend-style label on the top border.
 * Border color and animation change based on execution status:
 * - idle/cancelled/success: neutral border
 * - running/pending: Apple Intelligence-style animated prismatic gradient border
 * - error: red border
 */
export const NodeResultCard = ({
    name,
    status = "idle",
    children,
    className,
}: {
    name: string
    status?: NodeStatus
    children: React.ReactNode
    className?: string
}) => {
    const isRunning = status === "running" || status === "pending"
    const isError = status === "error"

    // Both states share the same outer wrapper so spacing is identical.
    // The legend label always sits at the top of this wrapper (top: 0, left: 10),
    // and the card body starts at pt-[11px] beneath it.
    const LEGEND_HEIGHT = 11

    if (isRunning) {
        return (
            <div
                className={clsx("node-result-card relative", className)}
                style={{paddingTop: LEGEND_HEIGHT}}
            >
                <div className="absolute bg-white px-1 z-[2]" style={{top: 0, left: 10}}>
                    <NodeNameTag name={name} />
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
                        className="node-result-card__gradient absolute pointer-events-none"
                        style={{
                            inset: -3,
                            borderRadius: BORDER_RADIUS + 3,
                            filter: "blur(8px)",
                            opacity: 0.4,
                        }}
                    />
                    <div
                        className="relative bg-white px-3 pb-2 pt-6"
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
            className={clsx("node-result-card relative", className)}
            style={{paddingTop: LEGEND_HEIGHT}}
        >
            <div className="absolute bg-white px-1 z-[1]" style={{top: 0, left: 10}}>
                <NodeNameTag name={name} />
            </div>
            <div
                className={clsx(
                    "rounded-lg px-3 pt-6 pb-2 border border-solid",
                    isError
                        ? "border-[var(--ant-color-error)]"
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
 * Injects the CSS for the Apple Intelligence-style animated gradient border.
 *
 * Uses `@property` for smooth angle interpolation of a `conic-gradient`
 * that rotates around the card. The gradient fills the outer container,
 * and a white inner div covers everything except the border-width gap.
 */
export function ensureNodeCardKeyframes() {
    if (typeof window === "undefined" || keyframesInjected) return
    keyframesInjected = true

    const style = document.createElement("style")
    style.setAttribute("data-node-card", "")
    style.textContent = `
        @property --node-card-angle {
            syntax: "<angle>";
            initial-value: 0deg;
            inherits: false;
        }

        @keyframes nodeCardSpin {
            to {
                --node-card-angle: 360deg;
            }
        }

        .node-result-card--running {
            --node-card-angle: 0deg;
        }

        .node-result-card__gradient {
            background: conic-gradient(
                from var(--node-card-angle),
                #ff6b8a,
                #c084fc,
                #60a5fa,
                #34d399,
                #fbbf24,
                #fb923c,
                #ff6b8a
            );
            animation: nodeCardSpin 3s linear infinite;
        }
    `
    document.head.appendChild(style)
}
