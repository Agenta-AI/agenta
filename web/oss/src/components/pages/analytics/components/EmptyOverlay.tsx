interface EmptyOverlayProps {
    title?: string
    subtitle?: string
}

// Centered "no data" message shared by the ghosted summary and chart empty states.
const EmptyOverlay = ({
    title = "No data to show",
    subtitle = "No runs match the current time range and filters.",
}: EmptyOverlayProps) => (
    <div className="absolute inset-0 flex items-center justify-center px-4 pointer-events-none">
        <div className="flex flex-col items-center gap-1 rounded-lg bg-colorBgContainer px-5 py-3 text-center">
            <span className="text-sm font-semibold text-colorText">{title}</span>
            <span className="max-w-[260px] text-[13px] leading-snug text-colorTextSecondary">
                {subtitle}
            </span>
        </div>
    </div>
)

export default EmptyOverlay
