import {useMemo} from "react"

import {
    PreferencesPage,
    usePreferenceBindings,
    type HostPreferenceItem,
    type ThemePickerProps,
} from "@agenta/settings-ui"
import {desktopEscapeHref, writeClassicModeCookie} from "@agenta/shared/hooks"
import {betaDeveloperModeFlagAtom, classicModeEnabledAtom} from "@agenta/shared/state"
import {THEME_OPTIONS, useThemeMode} from "@agenta/ui/theme"
import {useAtom} from "jotai"

import {developerViewPreviewSwitchesAtom} from "@/features/developer/developerViewAccess"

/**
 * Mobile binding for the shared preferences page; switches share storage with the desktop.
 * Developer Mode (the classic-mode preference) is how a user leaves /m, so turning it on must
 * navigate them there, unless beta developer mode keeps it here. That switch shows only while
 * Developer Mode is on. Developer views in preview add one Feature Flags switch each.
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
    const [classicMode, setClassicMode] = useAtom(classicModeEnabledAtom)
    const [betaDeveloperMode, setBetaDeveloperMode] = useAtom(betaDeveloperModeFlagAtom)

    const leaveForDesktop = () => {
        // Publish before navigating: the sync effect would not run before the document unloads,
        // and the desktop gate would read the old answer and bounce the user straight back.
        writeClassicModeCookie(true)
        window.location.assign(desktopEscapeHref())
    }

    const onClassicModeChange = (enabled: boolean) => {
        setClassicMode(enabled)
        if (enabled && !betaDeveloperMode) leaveForDesktop()
    }

    const onBetaDeveloperModeChange = (enabled: boolean) => {
        setBetaDeveloperMode(enabled)
        if (enabled) return
        // Store Developer Mode as an explicit choice, so the gate cookie keeps saying "1".
        setClassicMode(true)
        leaveForDesktop()
    }

    const bindings = usePreferenceBindings()

    const [previewSwitches, setPreviewSwitch] = useAtom(developerViewPreviewSwitchesAtom)
    const hostItems: HostPreferenceItem[] = [
        ...(classicMode
            ? [
                  {
                      section: "feature-flags",
                      key: "beta-developer-mode",
                      title: "Use new beta developer mode",
                      description:
                          "Developer Mode stays in this app and shows the Developer section, instead of opening the classic app.",
                      binding: {enabled: betaDeveloperMode, onChange: onBetaDeveloperModeChange},
                  },
              ]
            : []),
        ...previewSwitches.map(({view, optedIn}) => ({
            section: "feature-flags",
            key: `developer-view:${view.id}`,
            title: view.label,
            description: view.description,
            binding: {
                enabled: optedIn,
                onChange: (next: boolean) => setPreviewSwitch({viewId: view.id, optedIn: next}),
            },
        })),
    ]

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
