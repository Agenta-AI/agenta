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
 * A few files in translated folders still hold a hardcoded string and are left out of the
 * globs: audit/AuditEventDrawer.tsx, the auth AgentaBrand.tsx, and in navigation-ui
 * SessionSearchPalette.tsx, SidebarLogo.tsx and releaseItems.tsx.
 */
export const ERROR_FOLDERS = [
    "mobile/src/components",
    "mobile/src/features/agents",
    "mobile/src/features/app",
    "mobile/src/features/auth",
    "mobile/src/features/automations",
    "mobile/src/features/chat",
    "mobile/src/features/context",
    "mobile/src/features/home",
    "mobile/src/features/nav",
    "mobile/src/features/onboarding",
    "mobile/src/features/sessions",
    "mobile/src/features/settings",
    "mobile/src/features/skills",
    "packages/agenta-auth-ui/src/!(AgentaBrand).tsx",
    "packages/agenta-automation-ui/src",
    "packages/agenta-chat/src",
    "packages/agenta-entity-ui/src/agent",
    "packages/agenta-entity-ui/src/changes",
    "packages/agenta-entity-ui/src/drawers",
    "packages/agenta-entity-ui/src/mcpEndpoint",
    "packages/agenta-entity-ui/src/onboarding",
    "packages/agenta-entity-ui/src/shared",
    "packages/agenta-entity-ui/src/sharing",
    "packages/agenta-entity-ui/src/template-format",
    "packages/agenta-entity-ui/src/testcase",
    "packages/agenta-entity-ui/src/workflow",
    "packages/agenta-home-ui/src",
    "packages/agenta-navigation-ui/src/!(SessionSearchPalette|SidebarLogo|releaseItems).tsx",
    "packages/agenta-observability-ui/src/actions",
    "packages/agenta-observability-ui/src/analytics",
    "packages/agenta-observability-ui/src/cells",
    "packages/agenta-observability-ui/src/columns",
    "packages/agenta-observability-ui/src/delete",
    "packages/agenta-observability-ui/src/empty",
    "packages/agenta-observability-ui/src/filters",
    "packages/agenta-observability-ui/src/range",
    "packages/agenta-observability-ui/src/session",
    "packages/agenta-observability-ui/src/table",
    "packages/agenta-observability-ui/src/toolbar",
    "packages/agenta-sessions-ui/src",
    "packages/agenta-settings/src",
    "packages/agenta-settings-ui/src/*.tsx",
    "packages/agenta-settings-ui/src/access",
    "packages/agenta-settings-ui/src/audit/!(AuditEventDrawer).tsx",
    "packages/agenta-settings-ui/src/billing",
    "packages/agenta-settings-ui/src/channels",
    "packages/agenta-settings-ui/src/mcp",
    "packages/agenta-settings-ui/src/members",
    "packages/agenta-settings-ui/src/organizations",
    "packages/agenta-settings-ui/src/projects",
    "packages/agenta-settings-ui/src/providers",
    "packages/agenta-settings-ui/src/publish",
    "packages/agenta-settings-ui/src/secrets",
    "packages/agenta-settings-ui/src/shared",
    "packages/agenta-settings-ui/src/tools",
    "packages/agenta-settings-ui/src/webhooks",
    "packages/agenta-skills-ui/src",
    "packages/agenta-ui/src",
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
