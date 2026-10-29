/**
 * One choice card in a setup section: a logo and a label, ringed when it is the one in use. The
 * template card uses one per provider; the chat card one per account of the person.
 */
import type {ReactNode} from "react"

import {Plugs} from "@phosphor-icons/react"
import clsx from "clsx"
import Image from "next/image"

export const SetupChoiceCard = ({
    logo,
    label,
    sublabel,
    inUse,
    disabled,
    onClick,
}: {
    /** The logo; without one, the plug glyph. */
    logo?: string | null
    label: string
    /** A second line under the label, for example "Connected". */
    sublabel?: ReactNode
    inUse: boolean
    disabled?: boolean
    onClick: () => void
}) => (
    <button
        type="button"
        aria-pressed={inUse}
        disabled={disabled}
        onClick={onClick}
        className={clsx(
            "box-border flex min-h-[52px] min-w-[148px] shrink-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-solid bg-transparent px-3 py-2 text-left transition-colors",
            inUse
                ? "border-[var(--ag-colorPrimary)]"
                : "border-[var(--ag-colorBorderSecondary)] hover:border-[var(--ag-colorTextTertiary)]",
        )}
    >
        {logo ? (
            <Image
                src={logo}
                alt=""
                width={18}
                height={18}
                unoptimized
                className="shrink-0 object-contain"
            />
        ) : (
            <Plugs size={18} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
        )}
        <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-medium text-[var(--ag-colorText)]">{label}</span>
            {sublabel}
        </span>
    </button>
)

/** The row of choice cards, horizontally scrollable. */
export const SetupChoiceStrip = ({children}: {children: ReactNode}) => (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">{children}</div>
)
