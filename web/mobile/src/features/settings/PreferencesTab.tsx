import {PreferencesPage, type ThemePickerProps} from "@agenta/settings-ui"
import {desktopEscapeHref, writeClassicModeCookie} from "@agenta/shared/hooks"
import {classicModeEnabledAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {useAtom} from "jotai"

/**
 * Mobile binding: the shared preferences page — appearance, then the experiments. The switches
 * are per-user and share their storage with the desktop, so a flag turned on here is on there
 * too (same browser).
 *
 * Classic mode is how a user leaves this app: with it off the gate keeps sending them back here,
 * so turning it on has to carry them over to the desktop itself.
 */
export const PreferencesTab = ({theme}: {theme: ThemePickerProps}) => {
    const [classicMode, setClassicMode] = useAtom(classicModeEnabledAtom)
    const [inspector, setInspector] = useAtom(playgroundInspectorEnabledAtom)

    const onClassicModeChange = (enabled: boolean) => {
        setClassicMode(enabled)
        if (!enabled) return
        // Publish before navigating: the sync effect would not run before the document unloads,
        // and the desktop gate would read the old answer and bounce the user straight back.
        writeClassicModeCookie(true)
        window.location.assign(desktopEscapeHref())
    }

    return (
        <PreferencesPage
            theme={theme}
            flags={[
                {
                    key: "classic-mode",
                    title: "Classic mode",
                    description: "Use the full desktop app, with all platform areas.",
                    enabled: classicMode,
                    onChange: onClassicModeChange,
                },
                {
                    key: "playground-inspector",
                    title: "Playground inspector",
                    description:
                        "Show controls for inspecting Playground sessions and individual turns.",
                    enabled: inspector,
                    onChange: setInspector,
                    badge: "DEBUG",
                },
            ]}
        />
    )
}
