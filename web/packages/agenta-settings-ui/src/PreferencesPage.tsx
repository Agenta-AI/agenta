import {
    agentaChannelSurfaceEnabledAtom,
    channelDebugEnabledAtom,
    classicModeEnabledAtom,
    inprocessSandboxEnabledAtom,
    playgroundInspectorEnabledAtom,
} from "@agenta/shared/state"
import {Switch} from "@agenta/ui/ui"
import {useAtom} from "jotai"

import {SettingsRow, SettingsSection} from "./shared/SettingsSection"
import {ThemePicker, type ThemePickerProps} from "./ThemePicker"

/** One switch on the Preferences page. The key names the row, not its storage. */
export type PreferenceKey =
    | "classic-mode"
    | "inprocess-sandbox"
    | "playground-inspector"
    | "channel-debug"
    | "agenta-channel-surface"

export interface PreferenceItem {
    key: PreferenceKey
    title: string
    description: string
}

export interface PreferenceSection {
    key: string
    title: string
    description?: string
    items: PreferenceItem[]
}

/**
 * The page's sections, rows and copy. Defined once so `/w` and `/m` cannot drift: a host only
 * decides how each row is bound, never what it says or where it sits.
 */
export const PREFERENCE_SECTIONS: PreferenceSection[] = [
    {
        key: "feature-flags",
        title: "Feature Flags",
        items: [
            {
                key: "classic-mode",
                title: "Developer Mode",
                description: "Show Evaluation, Prompt Management, and Tracing in the navigation.",
            },
            {
                key: "inprocess-sandbox",
                title: "In-process agent runtime",
                description:
                    "Beta: offer Inprocess as a sandbox, which runs Pi inside the agent service and starts a sandbox only for commands.",
            },
        ],
    },
    {
        key: "debugging",
        title: "Debugging",
        description: "Tools for inspecting runs and channels.",
        items: [
            {
                key: "playground-inspector",
                title: "Playground inspector",
                description: "Show controls for inspecting Playground sessions and turns.",
            },
            {
                key: "channel-debug",
                title: "Channel debug",
                description: "Show channel spaces, threads and raw events in Channels settings.",
            },
            {
                key: "agenta-channel-surface",
                title: "Agenta channel probe",
                description: "Show the temporary in-browser channel probe.",
            },
        ],
    },
]

export interface PreferenceBinding {
    enabled: boolean
    onChange: (enabled: boolean) => void
}

export type PreferenceBindings = Partial<Record<PreferenceKey, PreferenceBinding>>

/**
 * Every row bound to its shared atom. A host replaces a binding only where its behavior differs
 * (`/m`'s Developer Mode switch also navigates to the desktop app).
 */
export const usePreferenceBindings = (): Record<PreferenceKey, PreferenceBinding> => {
    const [classicMode, setClassicMode] = useAtom(classicModeEnabledAtom)
    const [inprocessSandbox, setInprocessSandbox] = useAtom(inprocessSandboxEnabledAtom)
    const [inspector, setInspector] = useAtom(playgroundInspectorEnabledAtom)
    const [channelDebug, setChannelDebug] = useAtom(channelDebugEnabledAtom)
    const [channelProbe, setChannelProbe] = useAtom(agentaChannelSurfaceEnabledAtom)

    return {
        "classic-mode": {enabled: classicMode, onChange: setClassicMode},
        "inprocess-sandbox": {enabled: inprocessSandbox, onChange: setInprocessSandbox},
        "playground-inspector": {enabled: inspector, onChange: setInspector},
        "channel-debug": {enabled: channelDebug, onChange: setChannelDebug},
        "agenta-channel-surface": {enabled: channelProbe, onChange: setChannelProbe},
    }
}

export interface PreferencesPageProps {
    theme: ThemePickerProps
    /** Rows without a binding are not rendered; a section left empty is dropped. */
    bindings?: PreferenceBindings
}

/**
 * The Preferences tab: Appearance, then the shared {@link PREFERENCE_SECTIONS}.
 *
 * Theme is a per-viewer choice both apps show the same way; the switches share storage across
 * apps, so a choice made in `/m` holds on the desktop and the other way round.
 */
export const PreferencesPage = ({theme, bindings = {}}: PreferencesPageProps) => (
    <div className="flex flex-col gap-8">
        <SettingsSection title="Appearance">
            <div className="flex flex-col gap-3 px-[18px] py-4">
                <span className="font-medium text-foreground">Theme</span>
                <ThemePicker {...theme} />
            </div>
        </SettingsSection>

        {PREFERENCE_SECTIONS.map((section) => {
            const rows = section.items.flatMap((item) => {
                const binding = bindings[item.key]
                return binding ? [{item, binding}] : []
            })
            if (rows.length === 0) return null
            return (
                <SettingsSection
                    key={section.key}
                    data-section={section.key}
                    title={section.title}
                    description={section.description}
                >
                    {rows.map(({item, binding}) => (
                        <SettingsRow
                            key={item.key}
                            data-preference={item.key}
                            title={item.title}
                            description={item.description}
                            control={
                                <Switch
                                    checked={binding.enabled}
                                    onCheckedChange={binding.onChange}
                                    aria-label={item.title}
                                />
                            }
                        />
                    ))}
                </SettingsSection>
            )
        })}
    </div>
)
