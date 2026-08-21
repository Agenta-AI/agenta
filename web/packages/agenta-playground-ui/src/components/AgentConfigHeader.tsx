import type {ReactNode} from "react"

import {AgentSaveButton} from "./AgentSaveButton"

export interface AgentConfigHeaderProps {
    /** The revision being configured — what Save acts on. */
    revisionId: string
    /**
     * The bar's trailing control, after Save. On the desktop that is the collapse («) control;
     * the host owns it because the collapsed state is app-layer.
     *
     * NOT a Deploy button and NOT a kebab: PR #5943 removed both from the AGENT header by
     * design ("the kebab menu is gone — Revert lives on the Draft tag … per Mahmoud"), keeping
     * them on the classic prompt playground only.
     */
    trailing?: ReactNode
    /** `grow` instead of sticky, for an embedded drawer or a pane that scrolls with its content. */
    embedded?: boolean
    className?: string
}

/**
 * The agent config panel's header bar.
 *
 * The revision selector lives up in the page header on this surface, so this bar reads as the
 * config panel's "Configuration" header and carries Save plus the host's trailing control.
 *
 * There is no Commit button: config changes save themselves (#6126). Save appears only where
 * auto-commit deliberately will not act — see `AgentSaveButton` — so most of the time this bar
 * is just the title. Save STATUS lives with the version chip in the page header, which stays
 * visible when this bar is collapsed away. Deploy and the kebab belong to the CLASSIC prompt
 * header, not this one.
 *
 * Agent config below is a borderless summary, so the bar needs to read as a header. It gets a
 * subtly tinted surface (vs the plain content): an opaque container base (background-color) with
 * the translucent fill layered on top (background-image), so this sticky header stays opaque and
 * scrolled content cannot bleed through it.
 */
export const AgentConfigHeader = ({
    revisionId,
    trailing,
    embedded = false,
    className,
}: AgentConfigHeaderProps) => (
    <section
        className={`h-[48px] flex items-center justify-between overflow-hidden ${
            embedded ? "grow" : "sticky top-0 z-[10] w-full"
        } border-b border-colorBorderSecondary py-2 px-4 bg-colorBgContainer bg-[image:linear-gradient(var(--ag-colorFillTertiary),var(--ag-colorFillTertiary))] ${
            className ?? ""
        }`}
    >
        <div className="flex items-center gap-2 grow min-w-0 overflow-hidden">
            <span className="text-[13px] font-semibold text-colorText">Configuration</span>
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0 grow min-w-0">
            <AgentSaveButton revisionId={revisionId} />
            {trailing}
        </div>
    </section>
)
