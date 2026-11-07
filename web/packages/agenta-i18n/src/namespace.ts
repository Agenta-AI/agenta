import {useCallback} from "react"

import {useAtomValue} from "jotai"

import commonCatalog from "../locales/en/common.json"

import {EN_CATALOGS, type Namespace, type TranslationKey} from "./catalogs"
import {activeLanguageAtom, getActiveLanguage, type Catalog} from "./language"
import {translate, type TranslationValues} from "./translate"

// The small `common` namespace (Cancel, Save, ...) comes with every entry.
EN_CATALOGS.common = commonCatalog

/**
 * Registers a namespace's English catalog and returns `t` and `useT` typed to its keys and the
 * `common` keys. Each namespace has its own entry, so a page bundles only the text it uses.
 */
export const defineNamespace = <NS extends Namespace, Also extends Namespace = never>(
    namespace: NS,
    catalog: Catalog,
    // Other namespaces this entry carries; its `t` accepts their keys too.
    also: Partial<Record<Also, Catalog>> = {},
) => {
    Object.assign(EN_CATALOGS, also, {[namespace]: catalog})

    /** Text in the active language. Outside React it does not re-render; use `useT`. */
    const t = (key: TranslationKey<NS | Also | "common">, values?: TranslationValues): string =>
        translate(getActiveLanguage(), key, values)

    /** A `t` bound to the rendered language; the component re-renders when it changes. */
    const useT = () => {
        const language = useAtomValue(activeLanguageAtom)
        return useCallback(
            (key: TranslationKey<NS | Also | "common">, values?: TranslationValues) =>
                translate(language, key, values),
            [language],
        )
    }

    return {t, useT}
}
