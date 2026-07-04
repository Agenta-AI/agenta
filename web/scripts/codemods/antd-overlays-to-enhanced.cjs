#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-overlays-to-enhanced.cjs [--write] <path...>")
    process.exit(1)
}

const sourceFiles = []

function collect(target) {
    const stat = fs.statSync(target)
    if (stat.isFile()) {
        if (/\.(ts|tsx)$/.test(target)) sourceFiles.push(target)
        return
    }

    for (const entry of fs.readdirSync(target, {withFileTypes: true})) {
        if (["dist", "node_modules"].includes(entry.name)) continue
        collect(path.join(target, entry.name))
    }
}

for (const root of ROOTS) collect(root)

function importedName(specifier) {
    return specifier.propertyName?.text ?? specifier.name.text
}

function transform(file) {
    const source = fs.readFileSync(file, "utf8")
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const antdImports = sourceFile.statements.filter(
        (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === "antd",
    )
    const candidates = []

    for (const declaration of antdImports) {
        const bindings = declaration.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue

        for (const specifier of bindings.elements) {
            const imported = importedName(specifier)
            if (imported === "Modal" || imported === "Drawer") {
                candidates.push({declaration, specifier, imported, local: specifier.name.text})
            }
        }
    }

    if (candidates.length === 0) return null

    const blocked = new Set()
    const replacements = []

    function visit(node) {
        if (ts.isPropertyAccessExpression(node)) {
            for (const candidate of candidates) {
                if (ts.isIdentifier(node.expression) && node.expression.text === candidate.local) {
                    blocked.add(candidate.local)
                }
            }
        }

        for (const candidate of candidates) {
            if (!ts.isIdentifier(node) || node.text !== candidate.local) continue
            const parent = node.parent
            const isImport = ts.isImportSpecifier(parent)
            const isJsxTag =
                (ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                parent.tagName === node
            const isTypeQuery = ts.isTypeQueryNode(parent) && parent.exprName === node
            if (!isImport && (isJsxTag || isTypeQuery)) {
                replacements.push({start: node.getStart(sourceFile), end: node.getEnd(), candidate})
            }
        }

        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    const active = candidates.filter((candidate) => !blocked.has(candidate.local))
    if (active.length === 0) return null

    const activeLocals = new Set(active.map((candidate) => candidate.local))
    const edits = replacements
        .filter(({candidate}) => activeLocals.has(candidate.local))
        .map(({start, end, candidate}) => ({
            start,
            end,
            text: candidate.imported === "Modal" ? "EnhancedModal" : "EnhancedDrawer",
        }))

    for (const declaration of new Set(active.map((candidate) => candidate.declaration))) {
        const bindings = declaration.importClause.namedBindings
        const removed = new Set(
            active
                .filter((candidate) => candidate.declaration === declaration)
                .map((candidate) => candidate.specifier),
        )
        const remaining = bindings.elements.filter((element) => !removed.has(element))
        let text = ""

        if (remaining.length > 0) {
            const clause = remaining
                .map((element) => {
                    const typePrefix = element.isTypeOnly ? "type " : ""
                    const imported = element.propertyName?.text
                    return `${typePrefix}${imported ? `${imported} as ` : ""}${element.name.text}`
                })
                .join(", ")
            text = `import {${clause}} from "antd"`
        }

        edits.push({start: declaration.getStart(sourceFile), end: declaration.getEnd(), text})
    }

    const imports = []
    if (active.some((candidate) => candidate.imported === "Modal")) {
        imports.push('import {EnhancedModal} from "@agenta/ui/components/modal"')
    }
    if (active.some((candidate) => candidate.imported === "Drawer")) {
        imports.push('import {EnhancedDrawer} from "@agenta/ui/drawer"')
    }
    edits.push({start: 0, end: 0, text: `${imports.join("\n")}\n`})

    edits.sort((a, b) => b.start - a.start)
    let output = source
    for (const edit of edits)
        output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)

    const migrated = active.map((candidate) => candidate.imported).join(",")
    if (WRITE) fs.writeFileSync(file, output)
    return `${WRITE ? "updated" : "would update"}\t${migrated}\t${file}`
}

for (const file of sourceFiles) {
    const result = transform(file)
    if (result) console.log(result)
}
