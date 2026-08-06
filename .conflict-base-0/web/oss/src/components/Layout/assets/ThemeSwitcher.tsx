import {Desktop, Moon, Sun} from "@phosphor-icons/react"
import {Segmented} from "antd"

import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

// Compact Light/System/Dark switcher for the top bar (next to the version label).
const ThemeSwitcher = () => {
    const {themeMode, toggleAppTheme} = useAppTheme()

    return (
        <Segmented
            size="small"
            value={themeMode}
            onChange={(val) => toggleAppTheme(val as ThemeMode)}
            className="[&_.ant-segmented-group]:!gap-1 [&_.ant-segmented-item-label]:!flex [&_.ant-segmented-item-label]:!items-center [&_.ant-segmented-item-label]:!justify-center"
            options={[
                {
                    value: ThemeMode.Light,
                    icon: (
                        <span className="flex items-center justify-center">
                            <Sun size={14} />
                        </span>
                    ),
                    title: "Light",
                },
                {
                    value: ThemeMode.System,
                    icon: (
                        <span className="flex items-center justify-center">
                            <Desktop size={14} />
                        </span>
                    ),
                    title: "System",
                },
                {
                    value: ThemeMode.Dark,
                    icon: (
                        <span className="flex items-center justify-center">
                            <Moon size={14} />
                        </span>
                    ),
                    title: "Dark",
                },
            ]}
        />
    )
}

export default ThemeSwitcher
