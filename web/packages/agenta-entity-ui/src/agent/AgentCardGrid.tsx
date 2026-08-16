/** The roster's grid SHELL — geometry, the "New agent" cell, loading/empty. Cards are children. */
import type {ReactNode} from "react"

import {EmptyState, SkeletonBlock} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"

export interface AgentCardGridProps {
    /** The mapped agent cards. */
    children: ReactNode
    isLoading?: boolean
    /** Number of cards in `children` — drives the empty state. */
    count: number
    /** Omit to hide the dashed create cell (a read-only roster). */
    onCreate?: () => void
    createLabel?: string
    createHint?: string
    emptyText?: string
}

export const AgentCardGrid = ({
    children,
    isLoading = false,
    count,
    onCreate,
    createLabel = "New agent",
    createHint = "blank or from a template",
    emptyText = "No agents yet",
}: AgentCardGridProps) => {
    if (isLoading && count === 0) {
        return (
            <div className="flex flex-col gap-3 pt-5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <SkeletonBlock key={i} active className="h-6 w-full" />
                ))}
            </div>
        )
    }

    // `pt-5` is the room the grid variant's overhanging avatar needs. It belongs to the grid,
    // not to each card — on the card it left the avatar-less dashed cell misaligned.
    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-4 gap-y-10 pt-5">
            {children}

            {onCreate ? (
                // Dashed, so it reads as a slot to fill rather than an agent that exists.
                <button
                    type="button"
                    onClick={onCreate}
                    className="box-border flex h-full min-h-[148px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-colorBorder bg-transparent p-5 text-center transition-colors hover:border-colorPrimary"
                >
                    <PlusIcon size={18} className="text-colorTextTertiary" />
                    <span className="text-sm text-colorText">{createLabel}</span>
                    <span className="text-xs text-colorTextTertiary">{createHint}</span>
                </button>
            ) : null}

            {!isLoading && count === 0 ? (
                <div className="col-span-full">
                    <EmptyState
                        image="simple"
                        description={<span className="text-xs">{emptyText}</span>}
                    />
                </div>
            ) : null}
        </div>
    )
}
