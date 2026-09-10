import type {ReactNode} from "react"

/** The square chevron button in the templates header, mirroring the desktop strip's `HeaderButton`. */
export const TemplatePagerButton = ({
    label,
    disabled,
    onClick,
    children,
}: {
    label: string
    disabled: boolean
    onClick: () => void
    children: ReactNode
}) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        className={`box-border flex size-[22px] items-center justify-center rounded-md border border-solid bg-transparent p-0 transition-colors ${
            disabled
                ? "border-border text-muted-foreground/50 cursor-default"
                : "border-foreground text-foreground hover:bg-accent cursor-pointer"
        }`}
    >
        {children}
    </button>
)
