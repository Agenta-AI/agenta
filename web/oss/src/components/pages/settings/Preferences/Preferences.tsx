import {PreferencesPage, usePreferenceBindings} from "@agenta/settings-ui"

import {THEME_OPTIONS} from "@/oss/components/Layout/assets/themeOptions"
import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

/** OSS binding: this app's theme control on the shared page; every switch keeps its shared atom. */
const Preferences = () => {
    const {themeMode, toggleAppTheme} = useAppTheme()
    const bindings = usePreferenceBindings()

    return (
        <PreferencesPage
            theme={{
                options: THEME_OPTIONS.map(({mode, label}) => ({mode, label})),
                mode: themeMode,
                onSelect: (mode) => toggleAppTheme(mode as ThemeMode),
            }}
            bindings={bindings}
        />
    )
}

export default Preferences
