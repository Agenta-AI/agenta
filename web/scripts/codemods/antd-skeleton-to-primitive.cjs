#!/usr/bin/env node
// antd Skeleton → @agenta/primitive-ui Skeleton. Handles plain <Skeleton/>
// (title + N paragraph lines → a stack of Skeleton bars), Skeleton.Input and
// Skeleton.Button. Skeleton.Node/Avatar/Image and dynamic configs skip the
// file. All-or-nothing per file, mirroring the other codemods.

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-skeleton-to-primitive.cjs [--write] <path...>")
    process.exit(1)
}

const INPUT_SIZE = {small: "h-6", default: "h-8", large: "h-10"}
const BUTTON_SIZE = {small: "h-6 w-14", default: "h-8 w-16", large: "h-10 w-20"}

const files = []
function collect(target) {
    const stat = fs.statSync(target)
    if (stat.isFile()) {
        if (/\.(ts|tsx)$/.test(target)) files.push(target)
        return
    }
    for (const entry of fs.readdirSync(target, {withFileTypes: true})) {
        if (["dist", "node_modules"].includes(entry.name)) continue
        collect(path.join(target, entry.name))
    }
}
for (const root of ROOTS) collect(root)

function staticBoolean(attribute) {
    if (!attribute.initializer) return true
    if (!ts.isJsxExpression(attribute.initializer)) return null
    const expression = attribute.initializer.expression
    if (expression?.kind === ts.SyntaxKind.TrueKeyword) return true
    if (expression?.kind === ts.SyntaxKind.FalseKeyword) return false
    return null
}

function staticString(attribute) {
    if (!attribute.initializer) return null
    if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
    if (ts.isJsxExpression(attribute.initializer)) {
        const expression = attribute.initializer.expression
        if (expression && ts.isStringLiteral(expression)) return expression.text
    }
    return null
}

function rebuildAntdImport(declaration, removedSpecifier) {
    const clause = declaration.importClause
    const bindings = clause?.namedBindings
    if (!clause || !bindings || !ts.isNamedImports(bindings)) return null
    const remaining = bindings.elements.filter((element) => element !== removedSpecifier)
    if (remaining.length === 0 && !clause.name) return ""

    const parts = []
    if (clause.name) parts.push(clause.name.text)
    if (remaining.length > 0) {
        const named = remaining
            .map((element) => {
                const typePrefix = element.isTypeOnly ? "type " : ""
                const imported = element.propertyName?.text
                return `${typePrefix}${imported ? `${imported} as ` : ""}${element.name.text}`
            })
            .join(", ")
        parts.push(`{${named}}`)
    }
    return `import ${clause.isTypeOnly ? "type " : ""}${parts.join(", ")} from "antd"`
}

// paragraph={{rows: N}} with only static keys → {rows} | null when invalid
function parseParagraph(attribute) {
    if (!attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return null
    const expression = attribute.initializer.expression
    if (!expression) return null
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return {disabled: true}
    if (!ts.isObjectLiteralExpression(expression)) return null
    const result = {rows: 3}
    for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return null
        if (property.name.text === "rows" && ts.isNumericLiteral(property.initializer)) {
            result.rows = Number(property.initializer.text)
        } else if (property.name.text === "width") {
            // widths only affect the last line visually; ignore
        } else {
            return null
        }
    }
    return result
}

function transform(file) {
    const source = fs.readFileSync(file, "utf8")
    if (!source.includes("antd")) return null
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    let importDeclaration
    let importSpecifier
    let skeletonLocal
    const unsupported = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "antd")
            continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text
            if (imported === "Skeleton") {
                importDeclaration = statement
                importSpecifier = element
                skeletonLocal = element.name.text
                if (element.isTypeOnly) unsupported.push("type-only Skeleton import")
            }
            if (imported === "SkeletonProps") unsupported.push("file uses antd SkeletonProps")
        }
    }

    if (!skeletonLocal) return null
    if (source.includes("ant-skeleton")) unsupported.push("contains .ant-skeleton CSS selector")

    const jsxUsages = [] // {node, kind: "plain" | "Input" | "Button"}

    function kindForTag(tagName) {
        if (ts.isIdentifier(tagName) && tagName.text === skeletonLocal) return "plain"
        if (
            ts.isPropertyAccessExpression(tagName) &&
            ts.isIdentifier(tagName.expression) &&
            tagName.expression.text === skeletonLocal
        ) {
            return tagName.name.text
        }
        return null
    }

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === skeletonLocal) {
            const parent = node.parent
            const isTag =
                ((ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                    parent.tagName === node) ||
                (ts.isPropertyAccessExpression(parent) &&
                    parent.expression === node &&
                    (ts.isJsxOpeningElement(parent.parent) ||
                        ts.isJsxClosingElement(parent.parent) ||
                        ts.isJsxSelfClosingElement(parent.parent)))
            const supported = ts.isImportSpecifier(parent) || isTag
            if (!supported) unsupported.push(`non-JSX ${skeletonLocal} usage`)
        }
        if (ts.isJsxSelfClosingElement(node)) {
            const kind = kindForTag(node.tagName)
            if (kind) {
                if (["plain", "Input", "Button"].includes(kind)) {
                    jsxUsages.push({node, kind})
                } else {
                    unsupported.push(`Skeleton.${kind} not supported`)
                }
            }
        } else if (ts.isJsxOpeningElement(node)) {
            const kind = kindForTag(node.tagName)
            if (kind) unsupported.push("Skeleton with children")
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0 && unsupported.length === 0) unsupported.push("no JSX usages found")

    for (const {node, kind} of jsxUsages) {
        for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                unsupported.push("Skeleton uses spread props")
                continue
            }
            const name = property.name.getText(sourceFile)
            if (name.startsWith("aria-") || name.startsWith("data-")) continue
            const common = ["active", "className", "style", "key", "id", "size", "block"]
            const plainOnly = ["paragraph", "title", "loading", "round"]
            if (!common.includes(name) && !(kind === "plain" && plainOnly.includes(name))) {
                unsupported.push(`unsupported prop ${name}`)
            }
            if (name === "size" && staticString(property) === null)
                unsupported.push("size is dynamic")
            if (name === "block" && staticBoolean(property) === null)
                unsupported.push("block is dynamic")
            if (name === "loading") unsupported.push("loading prop (conditional wrapper)")
            if (name === "paragraph" && parseParagraph(property) === null)
                unsupported.push("paragraph config is complex")
            if (name === "title" && staticBoolean(property) === null)
                unsupported.push("title is dynamic")
            if (
                name === "className" &&
                property.initializer &&
                !ts.isStringLiteral(property.initializer)
            )
                unsupported.push("className is dynamic")
        }
    }

    if (unsupported.length > 0) {
        return `skipped\t${file}\t${[...new Set(unsupported)].join("; ")}`
    }

    const edits = []

    for (const {node, kind} of jsxUsages) {
        const attrs = new Map()
        for (const property of node.attributes.properties) {
            attrs.set(property.name.getText(sourceFile), property)
        }
        const classText =
            attrs.has("className") && attrs.get("className").initializer
                ? attrs.get("className").initializer.text
                : ""
        const size = attrs.has("size") ? (staticString(attrs.get("size")) ?? "default") : "default"
        const block = attrs.has("block") && staticBoolean(attrs.get("block"))
        // carry key/style verbatim so dynamic heights and list keys survive
        const keyAttr = attrs.get("key")
        const styleAttr = attrs.get("style")
        const extra =
            (keyAttr ? ` ${keyAttr.getText(sourceFile)}` : "") +
            (styleAttr ? ` ${styleAttr.getText(sourceFile)}` : "")
        const hasWidthClass = /(^| )w-/.test(classText)

        let replacement
        if (kind === "Input") {
            const classes = [
                INPUT_SIZE[size] ?? "h-8",
                block ? "w-full" : hasWidthClass ? "" : "w-40",
                classText,
            ]
                .filter(Boolean)
                .join(" ")
            replacement = `<Skeleton${extra} className=${JSON.stringify(classes)} />`
        } else if (kind === "Button") {
            const classes = [BUTTON_SIZE[size] ?? "h-8 w-16", block ? "w-full" : "", classText]
                .filter(Boolean)
                .join(" ")
            replacement = `<Skeleton${extra} className=${JSON.stringify(classes)} />`
        } else {
            const paragraph = attrs.has("paragraph")
                ? parseParagraph(attrs.get("paragraph"))
                : {rows: 3}
            const withTitle = attrs.has("title") ? staticBoolean(attrs.get("title")) : true
            const lines = []
            if (withTitle) lines.push(`<Skeleton className="h-4 w-2/5" />`)
            if (!paragraph.disabled) {
                const rows = paragraph.rows ?? 3
                for (let index = 0; index < rows; index += 1) {
                    const width = index === rows - 1 ? "w-3/5" : "w-full"
                    lines.push(`<Skeleton className="h-3 ${width}" />`)
                }
            }
            const wrapperClass = ["flex w-full flex-col gap-3", classText].filter(Boolean).join(" ")
            replacement = `<div${extra} className=${JSON.stringify(wrapperClass)}>${lines.join("")}</div>`
        }

        edits.push({start: node.getStart(sourceFile), end: node.getEnd(), text: replacement})
    }

    let importText = ""
    if (!source.includes('from "@agenta/primitive-ui/components/skeleton"')) {
        importText = `import {Skeleton} from "@agenta/primitive-ui/components/skeleton"\n`
    }
    edits.push({
        start: importDeclaration.getStart(sourceFile),
        end: importDeclaration.getStart(sourceFile),
        text: importText,
    })
    edits.push({
        start: importDeclaration.getStart(sourceFile),
        end: importDeclaration.getEnd(),
        text: rebuildAntdImport(importDeclaration, importSpecifier),
    })

    edits.sort((a, b) => b.start - a.start || b.end - a.end)
    let output = source
    for (const edit of edits)
        output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
    if (WRITE) fs.writeFileSync(file, output)
    return `${WRITE ? "updated" : "would update"}\t${file}\t${jsxUsages.length} usages`
}

for (const file of files) {
    const result = transform(file)
    if (result) console.log(result)
}
