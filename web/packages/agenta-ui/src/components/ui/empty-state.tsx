import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * EmptyState — an @agenta/ui port of antd `Empty` (plain div + inline SVG + cva, no Radix).
 * A centered column: illustration, description (`colorTextDescription`), optional footer
 * (action buttons). Reproduces antd's two built-in illustrations — the DEFAULT (184×152,
 * ~85px tall = controlHeightLG × 2.5) and the SIMPLE (64×41, controlHeightLG tall) — as inline
 * SVG. All fills/strokes resolve through the palette `--ag-*` bridge (`fill-*`/`stroke-*`
 * utilities) so the greys flip light↔dark with the app theme; geometry comes from the control
 * scale + Tailwind spacing, never raw pixels. `box-border` (preflight is OFF app-wide).
 *
 * antd → @agenta/ui mapping (call-sites): `description`/`children`/`className`/`style` map 1:1;
 * `image="default"|"simple"|ReactNode` replaces `image={Empty.PRESENTED_IMAGE_SIMPLE}` /
 * `PRESENTED_IMAGE_DEFAULT` / a custom node. See EmptyState.md.
 */

// antd default illustration (empty/empty.js): four fixed OPAQUE greys, carried verbatim in the
// `emptyImage` palette family (light = antd's #f5f5f7/#aeb8c2/#dce0e6/#fff; dark = each pre-
// composited at antd's `opacityImage` 0.65 over colorBgContainer, which is how antd themes this
// drawing). Do NOT reach for colorFill/colorFillTertiary here: those are TRANSLUCENT, so the
// paper and back flap ghost through the envelope front — a light-mode defect the VRT caught.
function DefaultEmptyImage() {
    return (
        <svg width="184" height="152" viewBox="0 0 184 152" xmlns="http://www.w3.org/2000/svg">
            <title>Empty</title>
            <g fill="none" fillRule="evenodd">
                <g transform="translate(24 31.7)">
                    <ellipse
                        className="fill-empty-shadow"
                        fillOpacity=".8"
                        cx="67.8"
                        cy="106.9"
                        rx="67.8"
                        ry="12.7"
                    />
                    <path
                        className="fill-empty-flap"
                        d="M122 69.7 98.1 40.2a6 6 0 0 0-4.6-2.2H42.1a6 6 0 0 0-4.6 2.2l-24 29.5V85H122z"
                    />
                    <path
                        className="fill-empty-sheet"
                        d="M33.8 0h68a4 4 0 0 1 4 4v93.3a4 4 0 0 1-4 4h-68a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4"
                    />
                    <path
                        className="fill-empty-front"
                        d="M42.7 10h50.2a2 2 0 0 1 2 2v25a2 2 0 0 1-2 2H42.7a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2m.2 39.8h49.8a2.3 2.3 0 1 1 0 4.5H42.9a2.3 2.3 0 0 1 0-4.5m0 11.7h49.8a2.3 2.3 0 1 1 0 4.6H42.9a2.3 2.3 0 0 1 0-4.6m79 43.5a7 7 0 0 1-6.8 5.4H20.5a7 7 0 0 1-6.7-5.4l-.2-1.8V69.7h26.3c2.9 0 5.2 2.4 5.2 5.4s2.4 5.4 5.3 5.4h34.8c2.9 0 5.3-2.4 5.3-5.4s2.3-5.4 5.2-5.4H122v33.5q0 1-.2 1.8"
                    />
                </g>
                <path
                    className="fill-empty-front"
                    d="m149.1 33.3-6.8 2.6a1 1 0 0 1-1.3-1.2l2-6.2q-4.1-4.5-4.2-10.4c0-10 10.1-18.1 22.6-18.1S184 8.1 184 18.1s-10.1 18-22.6 18q-6.8 0-12.3-2.8"
                />
                <g className="fill-empty-hole" transform="translate(149.7 15.4)">
                    <circle cx="20.7" cy="3.2" r="2.8" />
                    <path d="M5.7 5.6H0L2.9.7zM9.3.7h5v5h-5z" />
                </g>
            </g>
        </svg>
    )
}

// antd simple illustration (empty/simple.js): shadow = colorFillTertiary, outline stroke =
// colorFill, inner fill = colorFillQuaternary — all onBackground(colorBgContainer) in antd,
// reproduced with the translucent bridge tokens (visually equal over the container, theme-aware).
function SimpleEmptyImage() {
    return (
        <svg width="64" height="41" viewBox="0 0 64 41" xmlns="http://www.w3.org/2000/svg">
            <title>Empty</title>
            <g transform="translate(0 1)" fill="none" fillRule="evenodd">
                <ellipse className="fill-colorFillTertiary" cx="32" cy="33" rx="32" ry="7" />
                <g className="stroke-colorFill" fillRule="nonzero">
                    <path d="M55 12.8 44.9 1.3Q44 0 42.9 0H21.1q-1.2 0-2 1.3L9 12.8V22h46z" />
                    <path
                        className="fill-colorFillQuaternary"
                        d="M41.6 16c0-1.7 1-3 2.2-3H55v18.1c0 2.2-1.3 3.9-3 3.9H12c-1.7 0-3-1.7-3-3.9V13h11.2c1.2 0 2.2 1.3 2.2 3s1 2.9 2.2 2.9h14.8c1.2 0 2.2-1.4 2.2-3"
                    />
                </g>
            </g>
        </svg>
    )
}

// antd `-normal` (applied only for the SIMPLE preset): image height = emptyImgHeightMD
// (controlHeightLG) + root marginBlock = marginXL (32px). DEFAULT/custom keep emptyImgHeight
// (controlHeightLG × 2.5) and no root marginBlock. marginInline = marginXS (8px) always.
const emptyStateVariants = cva("box-border mx-2 text-center text-field-md", {
    variants: {
        simple: {true: "my-8", false: ""},
    },
    defaultVariants: {simple: false},
})

const emptyImageVariants = cva(
    // antd: `.ant-empty-image svg { height:100%; max-width:100%; margin:auto }`; the block is
    // centered by the root's text-align. marginBottom = marginXS (8px).
    "mb-2 [&_svg]:mx-auto [&_svg]:h-full [&_svg]:max-w-full [&_img]:h-full",
    {
        variants: {
            simple: {
                true: "h-control-lg",
                // controlHeightLG × 2.5, kept tied to the control scale (no raw pixels).
                false: "h-[calc(theme(height.control-lg)*2.5)]",
            },
        },
        defaultVariants: {simple: false},
    },
)

export interface EmptyStateProps
    extends
        Omit<React.HTMLAttributes<HTMLDivElement>, "children">,
        VariantProps<typeof emptyStateVariants> {
    /** `"default"` (large illustration) · `"simple"` (small) · a custom ReactNode. */
    image?: "default" | "simple" | React.ReactNode
    description?: React.ReactNode
    children?: React.ReactNode
}

export function EmptyState({
    className,
    image = "default",
    description,
    children,
    ...props
}: EmptyStateProps) {
    const isSimple = image === "simple"
    const imageNode =
        image === "simple" || image === "default" ? (
            isSimple ? (
                <SimpleEmptyImage />
            ) : (
                <DefaultEmptyImage />
            )
        ) : (
            image
        )

    return (
        <div
            data-slot="empty-state"
            className={cn(emptyStateVariants({simple: isSimple}), className)}
            {...props}
        >
            <div data-slot="empty-state-image" className={emptyImageVariants({simple: isSimple})}>
                {imageNode}
            </div>
            {description != null ? (
                <div data-slot="empty-state-description" className="text-colorTextDescription">
                    {description}
                </div>
            ) : null}
            {children != null ? (
                <div data-slot="empty-state-footer" className="mt-4">
                    {children}
                </div>
            ) : null}
        </div>
    )
}

export {emptyStateVariants, emptyImageVariants}
