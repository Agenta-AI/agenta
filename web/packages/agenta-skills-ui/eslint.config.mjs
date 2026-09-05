/**
 * @agenta/skills-ui wraps existing entity-ui components (SkillFormView and friends), so
 * antd is allowed here — but the shared singleton/barrel bans MUST survive: spreading
 * `restrictedImportPaths` is what keeps them (dropping it silently disables the bans).
 * The reverse edge is the contract: @agenta/entity-ui must never import this package.
 */
import base, {restrictedImportPaths} from "../eslint.config.mjs"

export default [
    ...base,
    {
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [...restrictedImportPaths],
                },
            ],
        },
    },
]
