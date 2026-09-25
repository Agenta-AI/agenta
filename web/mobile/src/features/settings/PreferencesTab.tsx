import {PreferencesPage, usePreferenceBindings, type ThemePickerProps} from "@agenta/settings-ui"
import {desktopEscapeHref, writeClassicModeCookie} from "@agenta/shared/hooks"
import {classicModeEnabledAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"

/**
 * Mobile binding for the shared preferences page; switches share storage with the desktop.
 * Developer Mode (the classic-mode preference) is how a user leaves /m, so turning it on must
 * navigate them there.
 */
export const PreferencesTab = ({theme}: {theme: ThemePickerProps}) => {
    const setClassicMode = useSetAtom(classicModeEnabledAtom)

    const onClassicModeChange = (enabled: boolean) => {
        setClassicMode(enabled)
        if (!enabled) return
        // Publish before navigating: the sync effect would not run before the document unloads,
        // and the desktop gate would read the old answer and bounce the user straight back.
        writeClassicModeCookie(true)
        window.location.assign(desktopEscapeHref())
    }

    const bindings = usePreferenceBindings()

    return (
        <PreferencesPage
            theme={theme}
            bindings={{
                ...bindings,
                "classic-mode": {...bindings["classic-mode"], onChange: onClassicModeChange},
            }}
        />
    )
}
