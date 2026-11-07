import {languageAtom, SUPPORTED_LANGUAGES, type Language, useT} from "@agenta/i18n"
import settingsPreferencesCatalog from "@agenta/i18n/catalogs/settings.preferences"
import {languagePickerEnabledAtom} from "@agenta/shared/state"
import {Label, RadioGroup, RadioGroupItem} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {SettingsSection} from "./shared/SettingsSection"

/** Each language in its own script, so a reader finds theirs whatever the current language. */
const LANGUAGE_NAMES: Record<Language, string> = {
    en: "English",
    "zh-CN": "中文 (Beta)",
    "ja-JP": "日本語 (Beta)",
}

/** Shown while the flag is on, and to anyone who already chose a language other than English. */
export const LanguagePicker = () => {
    const t = useT(settingsPreferencesCatalog)
    const enabled = useAtomValue(languagePickerEnabledAtom)
    const [language, setLanguage] = useAtom(languageAtom)
    if (!enabled && language === "en") return null

    return (
        <SettingsSection title={t("settings.preferences.language")} framed={false}>
            <RadioGroup
                value={language}
                onValueChange={(next) => setLanguage(next as Language)}
                className="flex flex-wrap gap-6"
            >
                {SUPPORTED_LANGUAGES.map((option) => (
                    <Label key={option} className="flex cursor-pointer items-center gap-2">
                        <RadioGroupItem value={option} aria-label={LANGUAGE_NAMES[option]} />
                        <span className="text-colorText">{LANGUAGE_NAMES[option]}</span>
                    </Label>
                ))}
            </RadioGroup>
        </SettingsSection>
    )
}
