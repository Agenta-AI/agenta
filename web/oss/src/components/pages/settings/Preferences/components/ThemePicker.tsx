import {Radio} from "antd"
import clsx from "clsx"

import {THEME_OPTIONS} from "@/oss/components/Layout/assets/themeOptions"
import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

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

const ThemeThumbnail = ({mode}: {mode: ThemeMode}) => (
    <div className="h-[100px] w-full overflow-hidden rounded-md border border-solid border-colorBorderSecondary">
        {mode === ThemeMode.System ? (
            <div className="flex h-full w-full">
                <div className="h-full w-1/2 overflow-hidden">
                    <PreviewSkeleton variant="light" />
                </div>
                <div className="h-full w-1/2 overflow-hidden">
                    <PreviewSkeleton variant="dark" />
                </div>
            </div>
        ) : (
            <PreviewSkeleton variant={mode === ThemeMode.Dark ? "dark" : "light"} />
        )}
    </div>
)

const ThemePicker = () => {
    const {themeMode, toggleAppTheme} = useAppTheme()

    return (
        <div className="flex flex-wrap gap-3">
            {THEME_OPTIONS.map(({mode, short}) => {
                const selected = themeMode === mode
                return (
                    <div
                        key={mode}
                        onClick={() => toggleAppTheme(mode)}
                        className={clsx(
                            "flex grow basis-[160px] cursor-pointer flex-col gap-3 rounded-xl border border-solid px-2 py-3 transition-colors",
                            selected
                                ? "border-colorPrimary"
                                : "border-colorBorder hover:border-colorPrimaryBorderHover",
                        )}
                    >
                        <ThemeThumbnail mode={mode} />
                        <Radio
                            checked={selected}
                            onChange={() => toggleAppTheme(mode)}
                            onClick={(e) => e.stopPropagation()}
                            className="px-1"
                        >
                            {short}
                        </Radio>
                    </div>
                )
            })}
        </div>
    )
}

export default ThemePicker
