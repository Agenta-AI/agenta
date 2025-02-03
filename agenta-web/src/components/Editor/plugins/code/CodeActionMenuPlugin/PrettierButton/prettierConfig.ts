import type {Options} from "prettier"

const PRETTIER_PARSER_MODULES: Record<string, Array<() => Promise<unknown>>> = {
    js: [() => import("prettier/parser-babel"), () => import("prettier/plugins/estree")],
    json: [() => import("prettier/plugins/estree"), () => import("prettier/parser-babel")],
    typescript: [
        () => import("prettier/parser-typescript"),
        () => import("prettier/plugins/estree"),
    ],
    yaml: [() => import("prettier/parser-yaml")],
}

export async function loadPrettierParserByLang(lang: string) {
    // Default to JS parser if specific parser not found
    const parserKey = PRETTIER_PARSER_MODULES[lang] ? lang : "js"
    const dynamicImports = PRETTIER_PARSER_MODULES[parserKey]
    const modules = await Promise.all(dynamicImports.map((dynamicImport) => dynamicImport()))
    return modules
}

export async function loadPrettierFormat() {
    const {format} = await import("prettier/standalone")
    return format
}

// Helper to complete incomplete code blocks
export function completeCodeBlock(code: string): string {
    const openBraces = (code.match(/{/g) || []).length
    const closeBraces = (code.match(/}/g) || []).length
    const missingBraces = openBraces - closeBraces

    if (missingBraces > 0) {
        return code + "\n" + "}".repeat(missingBraces)
    }
    return code
}

export const PRETTIER_OPTIONS_BY_LANG: Record<string, Options> = {
    js: {
        parser: "babel",
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        semi: true,
        singleQuote: true,
        trailingComma: "es5",
        bracketSpacing: true,
        arrowParens: "avoid",
        endOfLine: "lf",
    },
    json: {
        parser: "json",
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        semi: false,
        singleQuote: false,
        trailingComma: "none",
    },
    typescript: {
        parser: "typescript",
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        semi: true,
        singleQuote: true,
        trailingComma: "es5",
        bracketSpacing: true,
        arrowParens: "avoid",
    },
    yaml: {
        parser: "yaml",
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        semi: false,
        singleQuote: false,
        trailingComma: "none",
    },
}
