#!/usr/bin/env node
// antd Tag → @agenta/primitive-ui Badge.
// Color mapping (antd palette → Badge semantic variants):
//   green/success → success; red/error/volcano → destructive;
//   orange/gold/yellow/warning → warning; blue/geekblue/cyan/processing → info;
//   purple/magenta/pink/default/none → secondary.
// icon prop → first child. bordered drops (Badge has its own border model).
// Dynamic/hex colors, closable, CheckableTag skip the file. All-or-nothing
// per file, mirroring the other codemods.

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-tag-to-badge.cjs [--write] <path...>")
    process.exit(1)
}

const COLOR_VARIANT = {
    green: "success",
    success: "success",
    lime: "success",
    red: "destructive",
    error: "destructive",
    volcano: "destructive",
    orange: "warning",
    gold: "warning",
    yellow: "warning",
    warning: "warning",
    blue: "info",
    geekblue: "info",
    cyan: "info",
    processing: "info",
    purple: "secondary",
    magenta: "secondary",
    pink: "secondary",
    default: "secondary",
}
const PASSTHROUGH = new Set([
    "className",
    "style",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
    "title",
    "id",
    "key",
    "role",
    "tabIndex",
    "children",
])
const MIGRATED = new Set(["color", "bordered", "icon"])

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
    let tagLocal
    const unsupported = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "antd")
            continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text
            if (imported === "Tag") {
                importDeclaration = statement
                importSpecifier = element
                tagLocal = element.name.text
                if (element.isTypeOnly) unsupported.push("type-only Tag import")
            }
            if (imported === "TagProps") unsupported.push("file uses antd TagProps")
        }
    }

    if (!tagLocal) return null
    if (source.includes("ant-tag")) unsupported.push("contains .ant-tag CSS selector")

    const jsxUsages = [] // opening or self-closing nodes

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === tagLocal) {
            const parent = node.parent
            const isTag =
                ((ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                    parent.tagName === node) ||
                (ts.isPropertyAccessExpression(parent) && parent.expression === node)
            if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
                unsupported.push(`Tag.${parent.name.text} not supported`)
            }
            const supported = ts.isImportSpecifier(parent) || isTag
            if (!supported) unsupported.push(`non-JSX ${tagLocal} usage`)
        }
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            ts.isIdentifier(node.tagName) &&
            node.tagName.text === tagLocal
        ) {
            jsxUsages.push(node)
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0 && unsupported.length === 0) unsupported.push("no JSX usages found")

    for (const node of jsxUsages) {
        for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                unsupported.push("Tag uses spread props")
                continue
            }
            const name = property.name.getText(sourceFile)
            if (name.startsWith("aria-") || name.startsWith("data-")) continue
            if (!PASSTHROUGH.has(name) && !MIGRATED.has(name)) {
                unsupported.push(`unsupported prop ${name}`)
            }
            if (name === "color") {
                const value = staticString(property)
                if (value === null) unsupported.push("color is dynamic")
                else if (!COLOR_VARIANT[value]) unsupported.push(`unmapped color ${value}`)
            }
            if (
                name === "icon" &&
                (!property.initializer || !ts.isJsxExpression(property.initializer))
            )
                unsupported.push("icon is not a JSX expression")
        }
    }

    if (unsupported.length > 0) {
        return `skipped\t${file}\t${[...new Set(unsupported)].join("; ")}`
    }

    const edits = []

    for (const node of jsxUsages) {
        const attrs = new Map()
        for (const property of node.attributes.properties) {
            attrs.set(property.name.getText(sourceFile), property)
        }

        const color = attrs.has("color") ? staticString(attrs.get("color")) : null
        const variant = color ? COLOR_VARIANT[color] : "secondary"

        // remove migrated props
        for (const [name, property] of attrs) {
            if (MIGRATED.has(name)) {
                edits.push({start: property.getFullStart(), end: property.getEnd(), text: ""})
            }
        }

        let newAttrText = ` variant="${variant}"`

        const iconAttr = attrs.get("icon")
        const iconText = iconAttr ? `{${iconAttr.initializer.expression.getText(sourceFile)}}` : ""

        // rename tag
        const isSelfClosing = ts.isJsxSelfClosingElement(node)
        edits.push({
            start: node.tagName.getStart(sourceFile),
            end: node.tagName.getEnd(),
            text: "Badge",
        })
        if (!isSelfClosing) {
            const closing = node.parent.closingElement
            edits.push({
                start: closing.tagName.getStart(sourceFile),
                end: closing.tagName.getEnd(),
                text: "Badge",
            })
        }

        if (isSelfClosing && iconText) {
            edits.push({
                start: node.attributes.end,
                end: node.getEnd(),
                text: `${newAttrText}>${iconText}</Badge>`,
            })
        } else {
            edits.push({start: node.attributes.end, end: node.attributes.end, text: newAttrText})
            if (!isSelfClosing && iconText) {
                edits.push({start: node.getEnd(), end: node.getEnd(), text: iconText})
            }
        }
    }

    let importText = ""
    if (!source.includes('from "@agenta/primitive-ui/components/badge"')) {
        importText = `import {Badge} from "@agenta/primitive-ui/components/badge"\n`
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
