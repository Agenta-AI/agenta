/**
 * @agenta/skills-ui wraps existing entity-ui components (SkillFormView and friends). The
 * shared bans MUST survive: spreading `restrictedImportPaths` and `restrictedImportPatterns`
 * is what keeps them (dropping either silently disables those bans).
 * The reverse edge is the contract: @agenta/entity-ui must never import this package.
 */
import base, {restrictedImportPaths, restrictedImportPatterns} from "../eslint.config.mjs"

export default [
    ...base,
    {
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [...restrictedImportPaths],
                    patterns: [...restrictedImportPatterns],
                },
            ],
        },
    },
]
