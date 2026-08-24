import {PreferencesPage, type ThemePickerProps} from "@agenta/settings-ui"
import {agentVoiceInputEnabledAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {useAtom} from "jotai"

/**
 * Mobile binding: the shared preferences page — appearance, then the experiments. The switches
 * are per-user and share their storage with the desktop, so a flag turned on here is on there
 * too (same browser). Classic mode is left out: it drives the desktop's nav-area gate, and this
 * app's rail is a fixed list it could not change.
 */
export const PreferencesTab = ({theme}: {theme: ThemePickerProps}) => {
    const [voiceInput, setVoiceInput] = useAtom(agentVoiceInputEnabledAtom)
    const [inspector, setInspector] = useAtom(playgroundInspectorEnabledAtom)

    return (
        <PreferencesPage
            theme={theme}
            flags={[
                {
                    key: "voice-input",
                    title: "Voice input",
                    description: "Dictate messages, or record one, in the agent chat.",
                    enabled: voiceInput,
                    onChange: setVoiceInput,
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
