import type {ReactNode} from "react"

import {Compass, Plugs} from "@phosphor-icons/react"
import {Typography} from "antd"

interface OnRampCardProps {
    icon: ReactNode
    title: string
    description: string
    onClick?: () => void
}

const OnRampCard = ({icon, title, description, onClick}: OnRampCardProps) => (
    <button
        type="button"
        onClick={onClick}
        className="flex items-start gap-3 rounded-lg border border-solid border-transparent bg-[var(--ag-colorFillQuaternary)] p-4 text-left transition-colors hover:border-[var(--ag-colorBorderSecondary)] hover:bg-[var(--ag-colorFillTertiary)]"
    >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ag-colorFillTertiary)] text-[var(--ag-colorTextSecondary)]">
            {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-[13px] leading-snug text-[var(--ag-colorTextSecondary)]">
                {description}
            </span>
        </div>
    </button>
)

interface OnRampsProps {
    onBringApp?: () => void
    onExploreDemo?: () => void
}

/** Secondary first-run entry points: bring an existing app (tracing) / explore a demo. */
const OnRamps = ({onBringApp, onExploreDemo}: OnRampsProps) => {
    return (
        <section className="flex flex-col gap-3">
            <Typography.Title level={5} className="!m-0">
                Other ways to start
            </Typography.Title>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <OnRampCard
                    icon={<Plugs size={18} />}
                    title="Bring an existing app"
                    description="Send traces from your code — observe & evaluate what you already run."
                    onClick={onBringApp}
                />
                <OnRampCard
                    icon={<Compass size={18} />}
                    title="Explore a demo project"
                    description="Poke around a populated workspace. View-only, no setup."
                    onClick={onExploreDemo}
                />
            </div>
        </section>
    )
}

export default OnRamps
