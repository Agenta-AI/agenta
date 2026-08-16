import type {ReactNode} from "react"

import {CommitVariantChangesButton} from "./CommitVariantChanges"

export interface AgentConfigHeaderProps {
    /** The revision being configured — the commit's target. */
    revisionId: string
    /** The app the commit belongs to. */
    appId?: string | null
    /** Refresh host caches after a commit (see CommitHostAdapter). */
    onAfterCommit?: () => void
    onCommitted?: () => void
    /** Deploy, where the host can offer it — it still reads app-layer environment state. */
    deploy?: ReactNode
    /** The overflow menu, where the host has one. */
    menu?: ReactNode
    /** `grow` instead of sticky, for an embedded drawer or a pane that scrolls with its content. */
    embedded?: boolean
    className?: string
}

/**
 * The agent config panel's header bar.
 *
 * The revision selector lives up in the page header on this surface, so this bar reads as the
 * config panel's "Configuration" header and carries the action row: primary Commit, secondary
 * Deploy, ghost kebab.
 *
 * Agent config below is a borderless summary, so the bar needs to read as a header. It gets a
 * subtly tinted surface (vs the plain content): an opaque container base (background-color) with
 * the translucent fill layered on top (background-image), so this sticky header stays opaque and
 * scrolled content cannot bleed through it.
 */
export const AgentConfigHeader = ({
    revisionId,
    appId,
    onAfterCommit,
    onCommitted,
    deploy,
    menu,
    embedded = false,
    className,
}: AgentConfigHeaderProps) => (
    <section
        className={`h-[48px] flex items-center justify-between overflow-hidden ${
            embedded ? "grow" : "sticky top-0 z-[10] w-full"
        } border-b border-colorBorderSecondary py-2 px-4 bg-[var(--ag-c-FFFFFF)] bg-[image:linear-gradient(var(--ag-colorFillTertiary),var(--ag-colorFillTertiary))] ${
            className ?? ""
        }`}
    >
        <div className="flex items-center gap-2 grow min-w-0 overflow-hidden">
            <span className="text-[13px] font-semibold text-colorText">Configuration</span>
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0 grow min-w-0">
            {deploy}
            <CommitVariantChangesButton
                variantId={revisionId}
                label="Commit"
                type="primary"
                size="small"
                appId={appId}
                onAfterCommit={onAfterCommit}
                onCommitted={onCommitted}
                data-tour="commit-button"
            />
            {menu}
        </div>
    </section>
)
