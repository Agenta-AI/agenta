import {Label, RadioGroup, RadioGroupItem} from "@agenta/ui/ui"
import clsx from "clsx"

export interface ThemeChoice {
    mode: string
    label: string
}

export interface ThemePickerProps {
    options: ThemeChoice[]
    mode: string
    onSelect: (mode: string) => void
}

// Fixed colors: the thumbnails depict the themes, so they must not react to the active theme.
const PREVIEW_COLORS = {
    light: {bg: "#ffffff", panel: "#f0f0f0", bar: "#d0d0d0"},
    dark: {bg: "#0a0a0a", panel: "#1f1f1f", bar: "#3a3a3a"},
} as const

type PreviewVariant = keyof typeof PREVIEW_COLORS

const PreviewSkeleton = ({variant}: {variant: PreviewVariant}) => {
    const {bg, panel, bar} = PREVIEW_COLORS[variant]
    return (
        <div className="flex h-full w-full" style={{backgroundColor: bg}}>
            <div className="h-full w-1/4 shrink-0" style={{backgroundColor: panel}} />
            <div className="flex flex-1 flex-col gap-1.5 p-2">
                <div className="h-1.5 w-3/4 rounded-full" style={{backgroundColor: bar}} />
                <div className="h-1.5 w-1/2 rounded-full" style={{backgroundColor: bar}} />
                <div className="h-1.5 w-2/3 rounded-full" style={{backgroundColor: bar}} />
            </div>
        </div>
    )
}

/** "System default" shows both halves, since that is literally what it follows. */
const ThemeThumbnail = ({mode}: {mode: string}) => (
    <div className="h-[100px] w-full overflow-hidden rounded-md border border-solid border-colorBorderSecondary">
        {mode === "system" ? (
            <div className="flex h-full w-full">
                <div className="h-full w-1/2 overflow-hidden">
                    <PreviewSkeleton variant="light" />
                </div>
                <div className="h-full w-1/2 overflow-hidden">
                    <PreviewSkeleton variant="dark" />
                </div>
            </div>
        ) : (
            <PreviewSkeleton variant={mode === "dark" ? "dark" : "light"} />
        )}
    </div>
)

/**
 * The theme chooser: a thumbnail per mode. Presentational — the host owns what a mode means
 * and how it is applied, so the sidebar fly-out and this page stay one set of choices.
 */
export const ThemePicker = ({options, mode, onSelect}: ThemePickerProps) => (
    <RadioGroup
        value={mode}
        onValueChange={onSelect}
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
        {options.map((option) => (
            <Label
                key={option.mode}
                className={clsx(
                    "flex cursor-pointer flex-col gap-2 rounded-lg border border-solid p-2 transition-colors",
                    option.mode === mode
                        ? "border-colorPrimary"
                        : "border-colorBorderSecondary hover:border-colorBorder",
                )}
            >
                <ThemeThumbnail mode={option.mode} />
                <span className="flex items-center gap-2">
                    <RadioGroupItem value={option.mode} aria-label={option.label} />
                    <span className="text-colorText">{option.label}</span>
                </span>
            </Label>
        ))}
    </RadioGroup>
)
