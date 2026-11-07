import {type TranslationKey} from "@agenta/i18n"
import {useT} from "@agenta/i18n/settings"
import {isBetaDeveloperModeEnabled} from "@agenta/shared/api"
import {clearClassicModeCookie, mobileEscapeHref} from "@agenta/shared/hooks"
import {
    agentaChannelSurfaceEnabledAtom,
    betaDeveloperModeFlagAtom,
    channelDebugEnabledAtom,
    classicModeEnabledAtom,
    playgroundInspectorEnabledAtom,
} from "@agenta/shared/state"
import {Switch} from "@agenta/ui/ui"
import {useAtom} from "jotai"

import {LanguagePicker} from "./LanguagePicker"
import {SettingsRow, SettingsSection} from "./shared/SettingsSection"
import {ThemePicker, type ThemePickerProps} from "./ThemePicker"

/** One switch on the Preferences page. The key names the row, not its storage. */
export type PreferenceKey =
    | "classic-mode"
    | "beta-developer-mode"
    | "playground-inspector"
    | "channel-debug"
    | "agenta-channel-surface"

/** `title` and `description` are translation keys, translated at render. */
export interface PreferenceItem {
    key: PreferenceKey
    title: TranslationKey<"common" | "settings">
    description: TranslationKey<"common" | "settings">
}

export interface PreferenceSection {
    key: string
    title: TranslationKey<"common" | "settings">
    description?: TranslationKey<"common" | "settings">
    items: PreferenceItem[]
}

/**
 * The page's sections, rows and copy. Defined once so `/w` and `/m` cannot drift: a host decides
 * how each row is bound, and may add rows of its own through `hostItems`.
 */
export const PREFERENCE_SECTIONS: PreferenceSection[] = [
    {
        key: "feature-flags",
        title: "settings.preferences.featureFlags",
        items: [
            {
                key: "classic-mode",
                title: "settings.preferences.developerMode",
                description: "settings.preferences.developerModeDescription",
            },
            {
                key: "beta-developer-mode",
                title: "settings.preferences.betaDeveloperMode",
                description: "settings.preferences.betaDeveloperModeDescription",
            },
        ],
    },
    {
        key: "debugging",
        title: "settings.preferences.debugging",
        description: "settings.preferences.debuggingDescription",
        items: [
            {
                key: "playground-inspector",
                title: "settings.preferences.playgroundInspector",
                description: "settings.preferences.playgroundInspectorDescription",
            },
            {
                key: "channel-debug",
                title: "settings.preferences.channelDebug",
                description: "settings.preferences.channelDebugDescription",
            },
            {
                key: "agenta-channel-surface",
                title: "settings.preferences.channelProbe",
                description: "settings.preferences.channelProbeDescription",
            },
        ],
    },
]

export interface PreferenceBinding {
    enabled: boolean
    onChange: (enabled: boolean) => void
}

export type PreferenceBindings = Partial<Record<PreferenceKey, PreferenceBinding>>

/** Bound only while Developer Mode is on; every other row is always bound. */
type ConditionalPreferenceKey = "beta-developer-mode"

/**
 * Every row bound to its shared atom. A host replaces a binding only where its behavior differs
 * (`/m`'s Developer Mode switch also navigates to the desktop app).
 *
 * The beta developer mode row is bound only while Developer Mode is on and the deployment offers
 * it (`AGENTA_BETA_DEVELOPER_MODE`). Its default binding is the desktop's: turning it on sends the
 * user to `/m`, where Developer Mode then stays. Turning it off keeps Developer Mode on as an
 * explicit choice, so the gate cookie says "1" again.
 */
export const usePreferenceBindings = (): Record<
    Exclude<PreferenceKey, ConditionalPreferenceKey>,
    PreferenceBinding
> &
    PreferenceBindings => {
    const [classicMode, setClassicMode] = useAtom(classicModeEnabledAtom)
    const [betaDeveloperMode, setBetaDeveloperMode] = useAtom(betaDeveloperModeFlagAtom)
    const [inspector, setInspector] = useAtom(playgroundInspectorEnabledAtom)
    const [channelDebug, setChannelDebug] = useAtom(channelDebugEnabledAtom)
    const [channelProbe, setChannelProbe] = useAtom(agentaChannelSurfaceEnabledAtom)

    return {
        "classic-mode": {enabled: classicMode, onChange: setClassicMode},
        "playground-inspector": {enabled: inspector, onChange: setInspector},
        "channel-debug": {enabled: channelDebug, onChange: setChannelDebug},
        "agenta-channel-surface": {enabled: channelProbe, onChange: setChannelProbe},
        ...(classicMode &&
            isBetaDeveloperModeEnabled() && {
                "beta-developer-mode": {
                    enabled: betaDeveloperMode,
                    onChange: (enabled: boolean) => {
                        setBetaDeveloperMode(enabled)
                        if (!enabled) {
                            setClassicMode(true)
                            return
                        }
                        // Withdraw the "1" before leaving: the sync effect would not run before the
                        // document unloads, and `/m`'s gate would send the user straight back.
                        clearClassicModeCookie()
                        window.location.replace(mobileEscapeHref())
                    },
                },
            }),
    }
}

/**
 * A row only one host shows, placed after the shared rows of a {@link PREFERENCE_SECTIONS}
 * section. `/m` lists its developer views in preview this way; `/w` passes none.
 */
export interface HostPreferenceItem {
    /** The `key` of the section it joins. */
    section: string
    key: string
    title: string
    description: string
    binding: PreferenceBinding
}

export interface PreferencesPageProps {
    theme: ThemePickerProps
    /** Rows without a binding are not rendered; a section left empty is dropped. */
    bindings?: PreferenceBindings
    hostItems?: readonly HostPreferenceItem[]
}

/**
 * The Preferences tab: Appearance, then the shared {@link PREFERENCE_SECTIONS}.
 *
 * Theme is a per-viewer choice both apps show the same way; the switches share storage across
 * apps, so a choice made in `/m` holds on the desktop and the other way round.
 */
export const PreferencesPage = ({theme, bindings = {}, hostItems = []}: PreferencesPageProps) => {
    const t = useT()
    return (
        <div className="flex flex-col gap-8">
            <SettingsSection title={t("settings.preferences.appearance")} framed={false}>
                <ThemePicker {...theme} />
            </SettingsSection>

            <LanguagePicker />

            {PREFERENCE_SECTIONS.map((section) => {
                const rows = [
                    ...section.items.flatMap((item) => {
                        const binding = bindings[item.key]
                        return binding
                            ? [
                                  {
                                      item: {
                                          key: item.key,
                                          title: t(item.title),
                                          description: t(item.description),
                                      },
                                      binding,
                                  },
                              ]
                            : []
                    }),
                    // Host rows arrive with their own text.
                    ...hostItems
                        .filter((item) => item.section === section.key)
                        .map((item) => ({item, binding: item.binding})),
                ]
                if (rows.length === 0) return null
                return (
                    <SettingsSection
                        key={section.key}
                        data-section={section.key}
                        title={t(section.title)}
                        description={section.description ? t(section.description) : undefined}
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
}
