import {Tag} from "@agenta/ui/components/presentational"
import {Switch} from "@agenta/ui/ui"

import {ThemePicker, type ThemePickerProps} from "./ThemePicker"

export interface PreferenceFlag {
    key: string
    title: string
    description: string
    /** e.g. "DEBUG" — marks a flag that is not a product promise. */
    badge?: string
    enabled: boolean
    onChange: (enabled: boolean) => void
}

export interface PreferencesPageProps {
    theme: ThemePickerProps
    /** The host's experiment toggles; an app with none renders just Appearance. */
    flags?: PreferenceFlag[]
}

const FlagRow = ({flag}: {flag: PreferenceFlag}) => (
    <div className="flex items-start gap-3 border-0 border-b border-solid border-colorSplit py-4 first:pt-0 last:border-b-0 last:pb-0">
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <span className="font-medium text-colorText">{flag.title}</span>
                {flag.badge ? <Tag>{flag.badge}</Tag> : null}
            </div>
            <p className="m-0 mt-0.5 text-colorTextSecondary">{flag.description}</p>
        </div>
        <Switch
            checked={flag.enabled}
            onCheckedChange={flag.onChange}
            aria-label={flag.title}
            className="mt-0.5 shrink-0"
        />
    </div>
)

const SectionHeader = ({title}: {title: string}) => (
    <div className="flex flex-col gap-2">
        <h2 className="m-0 text-base font-semibold text-colorText">{title}</h2>
        <div className="h-px w-full bg-colorSplit" />
    </div>
)

/**
 * The Preferences tab: appearance, then the host's experiment toggles.
 *
 * Both apps show the same Appearance block — theme is a per-viewer choice, not an app one —
 * while the flags list is the host's, since an experiment only exists where it ships.
 */
export const PreferencesPage = ({theme, flags = []}: PreferencesPageProps) => (
    <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
            <SectionHeader title="Appearance" />
            <div className="flex flex-col gap-2">
                <span className="font-medium text-colorText">Theme</span>
                <ThemePicker {...theme} />
            </div>
        </div>

        {flags.length > 0 ? (
            <div className="flex flex-col gap-4">
                <SectionHeader title="Experiments" />
                <div className="flex flex-col">
                    {flags.map((flag) => (
                        <FlagRow key={flag.key} flag={flag} />
                    ))}
                </div>
            </div>
        ) : null}
    </section>
)
