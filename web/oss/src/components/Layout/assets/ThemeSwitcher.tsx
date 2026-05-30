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
            options={[
                {value: ThemeMode.Light, icon: <Sun size={14} />, title: "Light"},
                {value: ThemeMode.System, icon: <Desktop size={14} />, title: "System"},
                {value: ThemeMode.Dark, icon: <Moon size={14} />, title: "Dark"},
            ]}
        />
    )
}

export default ThemeSwitcher
