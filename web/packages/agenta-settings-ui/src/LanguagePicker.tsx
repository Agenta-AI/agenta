import {languageAtom, SUPPORTED_LANGUAGES, type Language, useT} from "@agenta/i18n"
import settingsPreferencesCatalog from "@agenta/i18n/catalogs/settings.preferences"
import {languagePickerEnabledAtom} from "@agenta/shared/state"
import {Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {SettingsSection} from "./shared/SettingsSection"

/** Each language in its own script, so a reader finds theirs whatever the current language. */
const LANGUAGE_NAMES: Record<Language, string> = {
    en: "English",
    "zh-CN": "中文 (简体)",
    "ja-JP": "日本語",
    "es-ES": "Español",
    "pt-BR": "Português (Brasil)",
    "de-DE": "Deutsch",
    "fr-FR": "Français",
}

/** System CJK fonts first, so Chinese and Japanese names render on any system without a web font. */
const NAME_FONT =
    '"PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK JP", sans-serif'

const LanguageLabel = ({language}: {language: Language}) => {
    const t = useT(settingsPreferencesCatalog)
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span style={{fontFamily: NAME_FONT}}>{LANGUAGE_NAMES[language]}</span>
            {language === "en" ? null : (
                <Badge className="text-muted-foreground">{t("settings.preferences.beta")}</Badge>
            )}
        </span>
    )
}

/** Shown while the flag is on, and to anyone who already chose a language other than English. */
export const LanguagePicker = () => {
    const t = useT(settingsPreferencesCatalog)
    const enabled = useAtomValue(languagePickerEnabledAtom)
    const [language, setLanguage] = useAtom(languageAtom)
    if (!enabled && language === "en") return null

    return (
        <SettingsSection title={t("settings.preferences.language")} framed={false}>
            <Select value={language} onValueChange={(next) => setLanguage(next as Language)}>
                <SelectTrigger
                    className="w-full max-w-xs"
                    aria-label={t("settings.preferences.language")}
                >
                    <SelectValue>
                        <LanguageLabel language={language} />
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {SUPPORTED_LANGUAGES.map((option) => (
                        <SelectItem key={option} value={option}>
                            <LanguageLabel language={option} />
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </SettingsSection>
    )
}
