/**
 * Lint guard against hardcoded user-visible English in /m and the @agenta/* packages.
 *
 * The rule `agenta-i18n/no-hardcoded-text` reports a JSX text node, or a string given to
 * one of the text props below, when the string has a letter. Move the string into a
 * catalog (see web/packages/agenta-i18n/README.md) and read it with `useT`.
 *
 * Severity: "warn" everywhere. "error" only inside the folders in ERROR_FOLDERS. A phase
 * that finishes translating a folder adds the folder to that array in its own PR.
 */
import path from "node:path"
import {fileURLToPath} from "node:url"

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Where a hardcoded string is an error. Each entry is a folder, or a glob of .tsx files,
 * relative to `web/`. Add your folder here when its strings are all in catalogs.
 *
 * Settings is listed except four files that still hold a hardcoded string. Add each back
 * once the string moves: LanguagePicker.tsx ("Beta"), audit/AuditEventDrawer.tsx,
 * mcp/McpServersSection.tsx ("OAuth"), and SsoProviderDialog.tsx and WebhookFormSheet.tsx
 * (example placeholders).
 */
export const ERROR_FOLDERS = [
    "mobile/src/features/settings/states",
    "mobile/src/features/settings/!(SsoProviderDialog|WebhookFormSheet).tsx",
    "packages/agenta-settings/src",
    "packages/agenta-settings-ui/src/access",
    "packages/agenta-settings-ui/src/billing",
    "packages/agenta-settings-ui/src/channels",
    "packages/agenta-settings-ui/src/members",
    "packages/agenta-settings-ui/src/organizations",
    "packages/agenta-settings-ui/src/projects",
    "packages/agenta-settings-ui/src/providers",
    "packages/agenta-settings-ui/src/publish",
    "packages/agenta-settings-ui/src/secrets",
    "packages/agenta-settings-ui/src/shared",
    "packages/agenta-settings-ui/src/tools",
    "packages/agenta-settings-ui/src/webhooks",
]

const TEXT_PROPS = new Set(["title", "placeholder", "label", "aria-label", "description", "alt"])

const LETTER = /\p{L}/u

/**
 * True when the string reads as user-visible words. A token that is a code, an address,
 * a slug or a color is not translated: JSON, name@company.com, company.com, my-org, #fff.
 */
const isTechnicalToken = (token) =>
    !LETTER.test(token) || token === token.toUpperCase() || /[@./:\\_#-]/.test(token)

function isUserText(value) {
    if (typeof value !== "string" || !LETTER.test(value)) return false
    return !value.trim().split(/\s+/).every(isTechnicalToken)
}

function stringOf(node) {
    if (!node) return null
    if (node.type === "Literal") return typeof node.value === "string" ? node.value : null
    if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
        return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("")
    }
    return null
}

const noHardcodedText = {
    meta: {
        type: "suggestion",
        schema: [],
        messages: {
            text: "Hardcoded user-visible text. Move it to a locale catalog and read it with useT().",
            prop: 'Hardcoded text in the "{{name}}" prop. Move it to a locale catalog and read it with useT().',
        },
    },
    create(context) {
        return {
            JSXText(node) {
                if (isUserText(node.value)) context.report({node, messageId: "text"})
            },
            JSXAttribute(node) {
                if (node.name.type !== "JSXIdentifier" || !TEXT_PROPS.has(node.name.name)) return
                const value =
                    node.value?.type === "JSXExpressionContainer"
                        ? node.value.expression
                        : node.value
                if (isUserText(stringOf(value))) {
                    context.report({node, messageId: "prop", data: {name: node.name.name}})
                }
            },
        }
    },
}

export const i18nPlugin = {rules: {"no-hardcoded-text": noHardcodedText}}

const IGNORED = [
    "**/*.test.{ts,tsx}",
    "**/*.spec.{ts,tsx}",
    "**/*.stories.{ts,tsx}",
    "**/storyFixtures.tsx",
    "**/__tests__/**",
    "**/tests/**",
    "**/dist/**",
]

/**
 * Flat-config blocks for one consumer. `baseDir` is the folder ESLint resolves `files`
 * against (the folder lint runs in); the error folders become globs relative to it.
 */
export function i18nGuardConfigs(baseDir) {
    const errorFiles = ERROR_FOLDERS.map((folder) =>
        path.relative(baseDir, path.join(WEB_DIR, folder)).split(path.sep).join("/"),
    )
        .filter((relative) => !relative.startsWith(".."))
        .map((relative) => (relative.endsWith(".tsx") ? relative : `${relative}/**/*.tsx`))
    return [
        {
            files: ["**/*.tsx"],
            ignores: IGNORED,
            plugins: {"agenta-i18n": i18nPlugin},
            rules: {"agenta-i18n/no-hardcoded-text": "warn"},
        },
        ...(errorFiles.length
            ? [
                  {
                      files: errorFiles,
                      ignores: IGNORED,
                      rules: {"agenta-i18n/no-hardcoded-text": "error"},
                  },
              ]
            : []),
    ]
}
