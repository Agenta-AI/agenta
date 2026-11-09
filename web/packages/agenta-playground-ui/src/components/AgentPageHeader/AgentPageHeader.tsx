import type {ReactNode} from "react"

import {AGENT_CHIP_BOX, AGENT_CHIP_FALLBACK} from "@agenta/entity-ui/agent"
import {SimpleTooltip} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"

// Re-exported from their home in @agenta/entity-ui, which owns the agent identity's chrome.
export {AGENT_CHIP_BOX, AGENT_CHIP_FALLBACK}

export interface AgentPageHeaderProps {
    /** Before the identity: the desktop's workflow kebab, the mobile screen's back link. */
    leading?: ReactNode
    /** The icon + name as one node (`AgentIdentity`), replacing the `icon`/`name` slot pair. */
    identity?: ReactNode
    /**
     * The agent's name. A node so a host can pass its inline-rename editor; a plain string
     * renders as the same 16px semibold label.
     */
    name?: ReactNode
    /** Shown instead of the agent identity where the surface has no agent ("Playground"). */
    title?: string
    /** Revision controls — the variant picker and/or `AgentRevisionStatus`. Preceded by a divider. */
    revision?: ReactNode
    /** Centered between the identity and the actions, whatever their widths: the session switcher. */
    center?: ReactNode
    /** Right-edge cluster: the mode switch, settings, and the desktop's evaluation actions. */
    actions?: ReactNode
    /** The agent's chip. Mobile passes a plain AgentGlyph; the desktop passes an interactive one
     * that opens the icon picker. Omitted, the bar draws the shared robot. */
    icon?: ReactNode
    /**
     * The bar holds page tabs in `center`: a darker tab-bar ground, and no bottom padding, so
     * the open tab can reach down to the bar's page line.
     */
    tabbed?: boolean
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
    identity,
    name,
    title,
    revision,
    center,
    actions,
    className,
    icon,
    tabbed = false,
}: AgentPageHeaderProps) => {
    return (
        <div
            // 48px is a phone touch target, not a desktop height: fixing it there made this bar
            // 48px against the desktop app's 41 (py-2 + a 24px row + the border) and pushed the
            // ENTIRE config pane 7px down — every ink band below it, uniformly. From `sm` up it
            // sizes to its content, as it always did.
            className={`${
                center
                    ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center"
                    : "flex items-center justify-between"
            } min-h-[48px] shrink-0 gap-2 border-x-0 border-t-0 border-b border-solid border-[var(--ag-shell-line)] px-2.5 sm:min-h-0 sm:gap-4 ${
                tabbed
                    ? "bg-[var(--ag-surface-tab-bar)] pt-2"
                    : "bg-[var(--ag-surface-raised)] py-2"
            } ${className ?? ""}`}
        >
            {/* min-w-0 + shrink (not shrink-0): on a phone the identity yields to the actions rather
            than pushing them off the bar; the name truncates instead. */}
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                {leading}
                {identity || name ? (
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                        {identity ?? (
                            <>
                                {icon ?? (
                                    <SimpleTooltip title="Agent">
                                        <span
                                            className={`${AGENT_CHIP_BOX} ${AGENT_CHIP_FALLBACK}`}
                                        >
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
                            </>
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

            {center}

            {/* flex-1 has a zero basis, so with min-w-0 this cluster gets only what the identity
            leaves and its buttons spill left over the name. Below `sm` it keeps its content width
            and the name truncates instead; from `sm` up min-w-0 lets the desktop's evaluator-tag
            strip scroll inside it. */}
            <div className="flex min-w-fit flex-1 items-center justify-end gap-2 sm:min-w-0">
                {actions}
            </div>
        </div>
    )
}
