import type {ReactNode} from "react"

import {SimpleTooltip} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"

/** The bar's 24px chip: geometry only, so a host's colours (or the agent's) are the only ones set. */
export const AGENT_CHIP_BOX = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md"

/** What the chip wears when nobody picked an icon. */
export const AGENT_CHIP_FALLBACK = "bg-colorFillSecondary text-[var(--ag-preset-cyan-text)]"

export interface AgentPageHeaderProps {
    /** Before the identity: the desktop's workflow kebab, the mobile screen's back link. */
    leading?: ReactNode
    /**
     * The agent's name. A node so a host can pass its inline-rename editor; a plain string
     * renders as the same 16px semibold label.
     */
    name?: ReactNode
    /** Shown instead of the agent identity where the surface has no agent ("Playground"). */
    title?: string
    /** Revision controls — the variant picker and/or `AgentRevisionStatus`. Preceded by a divider. */
    revision?: ReactNode
    /** Right-edge cluster: the mode switch, settings, and the desktop's evaluation actions. */
    actions?: ReactNode
    /** The agent's chip. Mobile passes a plain AgentGlyph; the desktop passes an interactive one
     * that opens the icon picker. Omitted, the bar draws the shared robot. */
    icon?: ReactNode
    className?: string
}

/**
 * The playground's top bar: who you are editing (agent icon, name, revision + saved state) on the
 * left, what you can do with it on the right.
 *
 * Both surfaces render THIS — the desktop playground above its two panels, and the mobile session
 * workspace above its own — so the identity line reads identically on either. Everything that is
 * host-specific (rename, the variant picker, evaluation actions) arrives as a slot.
 *
 * Type and spacing are RESPONSIVE, not per-app: a phone gets the 14px title and tight gaps every
 * other narrow screen uses, a desktop the 16px one, and neither host has to fork the bar or pass a
 * variant to say which viewport it is on.
 *
 * Borders are longhand-only (`border-x-0 border-t-0 border-b`): `border-0 border-b` needs
 * shorthand-before-longhand ordering, which the desktop's Tailwind v3 gives but mobile's v4 does
 * not guarantee. Colours stay on shared `--ag-*`/token utilities — `--ant-color-*` exists only
 * where antd runs, i.e. never on mobile.
 */
export const AgentPageHeader = ({
    leading,
    name,
    title,
    revision,
    actions,
    className,
    icon,
}: AgentPageHeaderProps) => {
    return (
        <div
            // 48px is a phone touch target, not a desktop height: fixing it there made this bar
            // 48px against the desktop app's 41 (py-2 + a 24px row + the border) and pushed the
            // ENTIRE config pane 7px down — every ink band below it, uniformly. From `sm` up it
            // sizes to its content, as it always did.
            className={`flex min-h-[48px] shrink-0 items-center justify-between gap-2 border-x-0 border-t-0 border-b border-solid border-[var(--ag-shell-line)] bg-[var(--ag-surface-raised)] px-2.5 py-2 sm:min-h-0 sm:gap-4 ${
                className ?? ""
            }`}
        >
            {/* min-w-0 + shrink (not shrink-0): on a phone the identity yields to the actions rather
            than pushing them off the bar; the name truncates instead. */}
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                {leading}
                {name ? (
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                        {icon ?? (
                            <SimpleTooltip title="Agent">
                                <span className={`${AGENT_CHIP_BOX} ${AGENT_CHIP_FALLBACK}`}>
                                    <Robot size={15} weight="fill" />
                                </span>
                            </SimpleTooltip>
                        )}
                        {typeof name === "string" ? (
                            <span className="truncate whitespace-nowrap text-sm font-[600] leading-[18px] text-colorText sm:text-[16px]">
                                {name}
                            </span>
                        ) : (
                            name
                        )}
                        {revision ? (
                            <>
                                <span
                                    aria-hidden
                                    className="mx-0.5 h-5 w-px shrink-0 bg-colorBorderSecondary sm:mx-1"
                                />
                                {revision}
                            </>
                        ) : null}
                    </div>
                ) : (
                    <span className="whitespace-nowrap text-sm font-[600] leading-[18px] text-colorText sm:text-[16px]">
                        {title}
                    </span>
                )}
            </div>

            {/* flex-1 + min-w-0: the desktop's evaluator-tag strip scrolls inside this cluster. */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{actions}</div>
        </div>
    )
}
