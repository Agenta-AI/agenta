import {useMemo} from "react"

import {
    PreferencesPage,
    usePreferenceBindings,
    type HostPreferenceItem,
    type ThemePickerProps,
} from "@agenta/settings-ui"
import {desktopEscapeHref, writeClassicModeCookie} from "@agenta/shared/hooks"
import {classicModeEnabledAtom} from "@agenta/shared/state"
import {THEME_OPTIONS, useThemeMode} from "@agenta/ui/theme"
import {useAtom, useSetAtom} from "jotai"

import {developerViewPreviewSwitchesAtom} from "@/features/developer/developerViewAccess"

/**
 * Mobile binding for the shared preferences page; switches share storage with the desktop.
 * Developer Mode (the classic-mode preference) is how a user leaves /m, so turning it on must
 * navigate them there. Developer views in preview add one Feature Flags switch each.
 */
export const PreferencesTab = () => {
    const {themeMode, setMode} = useThemeMode()
    const theme = useMemo<ThemePickerProps>(
        () => ({
            options: THEME_OPTIONS,
            mode: themeMode,
            onSelect: (mode) => setMode(mode as typeof themeMode),
        }),
        [themeMode, setMode],
    )
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

    const [previewSwitches, setPreviewSwitch] = useAtom(developerViewPreviewSwitchesAtom)
    const hostItems = useMemo<HostPreferenceItem[]>(
        () =>
            previewSwitches.map(({view, optedIn}) => ({
                section: "feature-flags",
                key: `developer-view:${view.id}`,
                title: view.label,
                description: view.description,
                binding: {
                    enabled: optedIn,
                    onChange: (next) => setPreviewSwitch({viewId: view.id, optedIn: next}),
                },
            })),
        [previewSwitches, setPreviewSwitch],
    )

    return (
        <PreferencesPage
            theme={theme}
            bindings={{
                ...bindings,
                "classic-mode": {...bindings["classic-mode"], onChange: onClassicModeChange},
            }}
            hostItems={hostItems}
        />
    )
}
