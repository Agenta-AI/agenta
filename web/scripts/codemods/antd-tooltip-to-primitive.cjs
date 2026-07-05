#!/usr/bin/env node
// antd Tooltip → @agenta/primitive-ui Tooltip/TooltipTrigger/TooltipContent.
// <Tooltip title={X} placement="p"><Child/></Tooltip> becomes
// <Tooltip><TooltipTrigger render={<Child/>} /><TooltipContent side/align>{X}</TooltipContent></Tooltip>.
// Strict gates: exactly one JSX-element child (same prop-forwarding contract
// antd required), static placement/delay, no nested Tooltips, no overlay
// styling or controlled-open props. All-or-nothing per file.

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-tooltip-to-primitive.cjs [--write] <path...>")
    process.exit(1)
}

const PLACEMENT_MAP = {
    top: {side: null, align: null},
    topLeft: {side: null, align: "start"},
    topRight: {side: null, align: "end"},
    bottom: {side: "bottom", align: null},
    bottomLeft: {side: "bottom", align: "start"},
    bottomRight: {side: "bottom", align: "end"},
    left: {side: "left", align: null},
    leftTop: {side: "left", align: "start"},
    leftBottom: {side: "left", align: "end"},
    right: {side: "right", align: null},
    rightTop: {side: "right", align: "start"},
    rightBottom: {side: "right", align: "end"},
}

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

function staticNumber(attribute) {
    if (!attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return null
    const expression = attribute.initializer.expression
    if (expression && ts.isNumericLiteral(expression)) return Number(expression.text)
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
    let tooltipLocal
    const unsupported = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "antd")
            continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text
            if (imported === "Tooltip") {
                importDeclaration = statement
                importSpecifier = element
                tooltipLocal = element.name.text
                if (element.isTypeOnly) unsupported.push("type-only Tooltip import")
            }
            if (imported === "TooltipProps") unsupported.push("file uses antd TooltipProps")
        }
    }

    if (!tooltipLocal) return null
    if (source.includes("ant-tooltip")) unsupported.push("contains .ant-tooltip CSS selector")
    if (source.includes('from "@agenta/primitive-ui/components/tooltip"'))
        unsupported.push("already imports primitive tooltip (mixed usage)")

    const jsxUsages = [] // JsxElement nodes

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === tooltipLocal) {
            const parent = node.parent
            const isTag =
                (ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                parent.tagName === node
            const supported = ts.isImportSpecifier(parent) || isTag
            if (!supported) unsupported.push(`non-JSX ${tooltipLocal} usage`)
        }
        if (
            ts.isJsxSelfClosingElement(node) &&
            ts.isIdentifier(node.tagName) &&
            node.tagName.text === tooltipLocal
        ) {
            unsupported.push("self-closing Tooltip (no child)")
        }
        if (
            ts.isJsxOpeningElement(node) &&
            ts.isIdentifier(node.tagName) &&
            node.tagName.text === tooltipLocal
        ) {
            jsxUsages.push(node.parent)
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0 && unsupported.length === 0) unsupported.push("no JSX usages found")

    // nested Tooltips would create overlapping text edits
    for (const a of jsxUsages) {
        for (const b of jsxUsages) {
            if (
                a !== b &&
                a.getStart(sourceFile) < b.getStart(sourceFile) &&
                b.getEnd() <= a.getEnd()
            ) {
                unsupported.push("nested Tooltip usages")
            }
        }
    }

    const parsed = []

    for (const element of jsxUsages) {
        const opening = element.openingElement
        const attrs = new Map()
        let spread = false
        for (const property of opening.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                spread = true
                continue
            }
            attrs.set(property.name.getText(sourceFile), property)
        }
        if (spread) {
            unsupported.push("Tooltip uses spread props")
            continue
        }

        for (const name of attrs.keys()) {
            if (!["title", "placement", "mouseEnterDelay", "arrow", "key"].includes(name)) {
                unsupported.push(`unsupported prop ${name}`)
            }
        }

        const titleAttr = attrs.get("title")
        if (!titleAttr || !titleAttr.initializer) {
            unsupported.push("Tooltip without title")
            continue
        }
        const titleStatic = staticString(titleAttr)
        if (titleStatic === "") {
            unsupported.push("empty title (dead tooltip)")
            continue
        }

        if (attrs.has("placement") && staticString(attrs.get("placement")) === null)
            unsupported.push("placement is dynamic")
        if (attrs.has("mouseEnterDelay") && staticNumber(attrs.get("mouseEnterDelay")) === null)
            unsupported.push("mouseEnterDelay is dynamic")

        const realChildren = element.children.filter(
            (child) => !(ts.isJsxText(child) && child.text.trim() === ""),
        )
        if (realChildren.length !== 1) {
            unsupported.push("Tooltip child is not exactly one node")
            continue
        }
        const child = realChildren[0]
        if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) {
            unsupported.push("Tooltip child is not a JSX element")
            continue
        }

        parsed.push({element, attrs, titleAttr, child})
    }

    if (unsupported.length > 0) {
        return `skipped\t${file}\t${[...new Set(unsupported)].join("; ")}`
    }

    const edits = []

    for (const {element, attrs, titleAttr, child} of parsed) {
        const placement = attrs.has("placement")
            ? PLACEMENT_MAP[staticString(attrs.get("placement"))]
            : {side: null, align: null}
        if (!placement) {
            return `skipped\t${file}\tunknown placement ${staticString(attrs.get("placement"))}`
        }

        let rootAttrs = ""
        if (attrs.has("key")) rootAttrs += ` ${attrs.get("key").getText(sourceFile)}`
        // mouseEnterDelay dropped: Base UI hover delay lives on the app-wide
        // TooltipProvider, not the per-tooltip root.

        let contentAttrs = ""
        if (placement.side) contentAttrs += ` side="${placement.side}"`
        if (placement.align) contentAttrs += ` align="${placement.align}"`

        const titleText = ts.isJsxExpression(titleAttr.initializer)
            ? `{${titleAttr.initializer.expression.getText(sourceFile)}}`
            : `{${titleAttr.initializer.getText(sourceFile)}}`

        const childText = child.getText(sourceFile)

        const replacement =
            `<Tooltip${rootAttrs}>` +
            `<TooltipTrigger render={${childText}} />` +
            `<TooltipContent${contentAttrs}>${titleText}</TooltipContent>` +
            `</Tooltip>`

        edits.push({start: element.getStart(sourceFile), end: element.getEnd(), text: replacement})
    }

    const importText = `import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"\n`
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
    return `${WRITE ? "updated" : "would update"}\t${file}\t${parsed.length} usages`
}

for (const file of files) {
    const result = transform(file)
    if (result) console.log(result)
}
