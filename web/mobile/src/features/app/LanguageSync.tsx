import {useLanguageSync} from "@agenta/i18n/language"

/** Loads the chosen language's text and sets `<html lang>`; renders nothing. */
export const LanguageSync = () => {
    useLanguageSync()
    return null
}
