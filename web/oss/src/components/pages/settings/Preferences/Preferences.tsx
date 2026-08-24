import {PreferencesPage} from "@agenta/settings-ui"
import {
    agentaChannelSurfaceEnabledAtom,
    agentVoiceInputEnabledAtom,
    playgroundInspectorEnabledAtom,
} from "@agenta/shared/state"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {THEME_OPTIONS} from "@/oss/components/Layout/assets/themeOptions"
import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {navSimplifiedOverrideAtom} from "@/oss/lib/onboarding/atoms"
import {advancedNavHiddenAtom} from "@/oss/state/onboarding/selectors"

/** OSS binding: this app's theme control and its experiment flags on the shared page. */
const Preferences = () => {
    const {themeMode, toggleAppTheme} = useAppTheme()
    const advancedNavHidden = useAtomValue(advancedNavHiddenAtom)
    const setNavSimplifiedOverride = useSetAtom(navSimplifiedOverrideAtom)
    const [playgroundInspectorEnabled, setPlaygroundInspectorEnabled] = useAtom(
        playgroundInspectorEnabledAtom,
    )
    const [agentVoiceInputEnabled, setAgentVoiceInputEnabled] = useAtom(agentVoiceInputEnabledAtom)
    const [agentaChannelSurfaceEnabled, setAgentaChannelSurfaceEnabled] = useAtom(
        agentaChannelSurfaceEnabledAtom,
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
                    enabled: !advancedNavHidden,
                    onChange: (enabled) => setNavSimplifiedOverride(!enabled),
                },
                {
                    key: "voice-input",
                    title: "Voice input",
                    description: "Dictate messages in the agent chat.",
                    enabled: agentVoiceInputEnabled,
                    onChange: setAgentVoiceInputEnabled,
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
                {
                    key: "agenta-channel-surface",
                    title: "Agenta channel probe",
                    description: "Show the temporary in-browser channel conversation probe.",
                    enabled: agentaChannelSurfaceEnabled,
                    onChange: setAgentaChannelSurfaceEnabled,
                    badge: "DEBUG",
                },
            ]}
        />
    )
}

export default Preferences
