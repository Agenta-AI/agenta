import type {CatalogLoader, TranslatedLanguage} from "../../src/registry"

/** A test loader from a map of languages; a language not in the map rejects, like a missing file. */
export const byLanguage =
    (files: Partial<Record<TranslatedLanguage, () => ReturnType<CatalogLoader>>>): CatalogLoader =>
    (language) =>
        files[language]?.() ?? Promise.reject(new Error(`no ${language} file`))
