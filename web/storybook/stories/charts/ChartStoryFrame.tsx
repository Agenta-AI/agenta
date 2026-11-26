import type {ReactNode} from "react"

/** A card-sized frame, like the run overview card that hosts these charts. */
export function ChartStoryFrame({heading, children}: {heading: string; children: ReactNode}) {
    return (
        <div className="w-full max-w-[640px] rounded-lg border border-colorBorderSecondary bg-colorBgContainer p-4">
            <div className="mb-3 text-sm font-medium text-colorText">{heading}</div>
            {children}
        </div>
    )
}
