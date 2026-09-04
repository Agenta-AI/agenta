import {PreferencesPage} from "@agenta/settings-ui"
import {classicModeEnabledAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {useAtom} from "jotai"

import {THEME_OPTIONS} from "@/oss/components/Layout/assets/themeOptions"
import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

/** OSS binding: this app's theme control and its experiment flags on the shared page. */
const Preferences = () => {
    const {themeMode, toggleAppTheme} = useAppTheme()
    const [classicModeEnabled, setClassicModeEnabled] = useAtom(classicModeEnabledAtom)
    const [playgroundInspectorEnabled, setPlaygroundInspectorEnabled] = useAtom(
        playgroundInspectorEnabledAtom,
    )

    return (
        <PreferencesPage
            theme={{
                options: THEME_OPTIONS.map(({mode, label}) => ({mode, label})),
                mode: themeMode,
                onSelect: (mode) => toggleAppTheme(mode as ThemeMode),
            }}
            flags={[
                {
                    key: "classic-mode",
                    title: "Classic mode",
                    description: "Show all platform areas in the navigation.",
                    enabled: classicModeEnabled,
                    onChange: setClassicModeEnabled,
                },
                {
                    key: "playground-inspector",
                    title: "Playground inspector",
                    description:
                        "Show controls for inspecting Playground sessions and individual turns.",
                    enabled: playgroundInspectorEnabled,
                    onChange: setPlaygroundInspectorEnabled,
                    badge: "DEBUG",
                },
            ]}
        />
    )
}

export default Preferences
