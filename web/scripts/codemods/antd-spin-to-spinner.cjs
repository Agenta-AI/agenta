#!/usr/bin/env node
// antd Spin → @agenta/primitive-ui Spinner. Standalone spinners only: the
// wrapper form (<Spin spinning={x}>{content}</Spin>) has no shadcn analogue and
// skips the file. All-or-nothing per file, mirroring the other codemods.

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-spin-to-spinner.cjs [--write] <path...>")
    process.exit(1)
}

const SIZE_CLASS = {small: "size-3.5", default: null, large: "size-6"}

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
    let spinLocal
    const unsupported = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "antd")
            continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text
            if (imported === "Spin") {
                importDeclaration = statement
                importSpecifier = element
                spinLocal = element.name.text
                if (element.isTypeOnly) unsupported.push("type-only Spin import")
            }
            if (imported === "SpinProps") unsupported.push("file uses antd SpinProps")
        }
    }

    if (!spinLocal) return null
    if (source.includes("ant-spin")) unsupported.push("contains .ant-spin CSS selector")

    const jsxUsages = []

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === spinLocal) {
            const parent = node.parent
            const isTag =
                (ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                parent.tagName === node
            const supported = ts.isImportSpecifier(parent) || isTag
            if (!supported) unsupported.push(`non-JSX ${spinLocal} usage`)
        }
        if (
            ts.isJsxSelfClosingElement(node) &&
            ts.isIdentifier(node.tagName) &&
            node.tagName.text === spinLocal
        ) {
            jsxUsages.push(node)
        }
        if (
            ts.isJsxOpeningElement(node) &&
            ts.isIdentifier(node.tagName) &&
            node.tagName.text === spinLocal
        ) {
            // wrapper form: only treat as standalone when children are whitespace
            const parentElement = node.parent
            const hasRealChildren = parentElement.children.some(
                (child) => !(ts.isJsxText(child) && child.text.trim() === ""),
            )
            if (hasRealChildren) unsupported.push("Spin wraps content (overlay form)")
            else jsxUsages.push(node)
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0 && unsupported.length === 0) unsupported.push("no JSX usages found")

    for (const node of jsxUsages) {
        for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                unsupported.push("Spin uses spread props")
                continue
            }
            const name = property.name.getText(sourceFile)
            if (name.startsWith("aria-") || name.startsWith("data-")) continue
            if (!["size", "spinning", "className", "style", "key", "id"].includes(name)) {
                unsupported.push(`unsupported prop ${name}`)
            }
            if (name === "size" && staticString(property) === null)
                unsupported.push("size is dynamic")
            if (name === "spinning") {
                const value = staticBoolean(property)
                if (value === false) unsupported.push("spinning={false} (dead spinner)")
                if (value === null) {
                    // dynamic spinning only supported in JSX-children position
                    const container = ts.isJsxSelfClosingElement(node) ? node : node.parent
                    const parent = container.parent
                    if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) {
                        unsupported.push("dynamic spinning outside JSX children")
                    }
                }
            }
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

        const sizeClass = attrs.has("size") ? SIZE_CLASS[staticString(attrs.get("size"))] : null
        const classAttr = attrs.get("className")
        let classText = ""
        if (classAttr && ts.isStringLiteral(classAttr.initializer)) {
            classText = classAttr.initializer.text
        }
        const classes = [sizeClass, classText].filter(Boolean).join(" ")
        const classOut = classes ? ` className=${JSON.stringify(classes)}` : ""
        const styleAttr = attrs.get("style")
        const styleOut = styleAttr ? ` ${styleAttr.getText(sourceFile)}` : ""
        const keyAttr = attrs.get("key")
        const keyOut = keyAttr ? ` ${keyAttr.getText(sourceFile)}` : ""

        const spinnerText = `<Spinner${keyOut}${classOut}${styleOut} />`

        const spinningAttr = attrs.get("spinning")
        const dynamicSpin =
            spinningAttr && staticBoolean(spinningAttr) === null
                ? spinningAttr.initializer.expression.getText(sourceFile)
                : null

        const container = ts.isJsxSelfClosingElement(node) ? node : node.parent
        const replacement = dynamicSpin ? `{${dynamicSpin} ? ${spinnerText} : null}` : spinnerText

        edits.push({
            start: container.getStart(sourceFile),
            end: container.getEnd(),
            text: replacement,
        })

        if (classAttr && !ts.isStringLiteral(classAttr.initializer)) {
            // dynamic className: keep the expression verbatim
            const expr = classAttr.getText(sourceFile)
            const withDynamicClass = dynamicSpin
                ? `{${dynamicSpin} ? <Spinner ${expr}${styleOut} /> : null}`
                : `<Spinner ${expr}${styleOut} />`
            edits[edits.length - 1].text = withDynamicClass
        }
    }

    let importText = ""
    if (!source.includes('from "@agenta/primitive-ui/components/spinner"')) {
        importText = `import {Spinner} from "@agenta/primitive-ui/components/spinner"\n`
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
