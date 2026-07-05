#!/usr/bin/env node
// antd Input / Input.TextArea → @agenta/primitive-ui Input / Textarea.
// prefix/suffix get the relative-wrapper treatment; onPressEnter becomes an
// onKeyDown Enter guard; status="error" becomes aria-invalid; autoSize drops
// (primitive Textarea is field-sizing-content). allowClear, addons,
// Password/Search/OTP variants and dynamic configs skip the file.
// All-or-nothing per file, mirroring the other codemods.

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-input-to-primitive.cjs [--write] <path...>")
    process.exit(1)
}

const PASSTHROUGH = new Set([
    "value",
    "defaultValue",
    "onChange",
    "onBlur",
    "onFocus",
    "onClick",
    "onKeyDown",
    "onKeyUp",
    "onPaste",
    "placeholder",
    "disabled",
    "maxLength",
    "minLength",
    "autoFocus",
    "className",
    "style",
    "id",
    "name",
    "type",
    "readOnly",
    "ref",
    "key",
    "min",
    "max",
    "step",
    "autoComplete",
    "spellCheck",
    "role",
    "tabIndex",
    "title",
    "required",
    "rows",
])
const MIGRATED = new Set([
    "status",
    "size",
    "variant",
    "onPressEnter",
    "prefix",
    "suffix",
    "autoSize",
])
const SIZE_CLASS = {small: "h-6", middle: null, large: "h-10"}

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
    let inputLocal
    const unsupported = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "antd")
            continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text
            if (imported === "Input") {
                importDeclaration = statement
                importSpecifier = element
                inputLocal = element.name.text
                if (element.isTypeOnly) unsupported.push("type-only Input import")
            }
            if (["InputProps", "InputRef", "TextAreaProps"].includes(imported))
                unsupported.push(`file uses antd ${imported}`)
        }
    }

    if (!inputLocal) return null
    if (source.includes("ant-input")) unsupported.push("contains .ant-input CSS selector")

    const jsxUsages = [] // {node, kind: "input" | "textarea"}

    function kindForTag(tagName) {
        if (ts.isIdentifier(tagName) && tagName.text === inputLocal) return "input"
        if (
            ts.isPropertyAccessExpression(tagName) &&
            ts.isIdentifier(tagName.expression) &&
            tagName.expression.text === inputLocal
        ) {
            return tagName.name.text === "TextArea" ? "textarea" : tagName.name.text
        }
        return null
    }

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === inputLocal) {
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
            if (!supported) unsupported.push(`non-JSX ${inputLocal} usage`)
        }
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
            const kind = kindForTag(node.tagName)
            if (kind && ts.isJsxOpeningElement(node)) {
                unsupported.push("Input with children")
            } else if (kind === "input" || kind === "textarea") {
                jsxUsages.push({node, kind})
            } else if (kind) {
                unsupported.push(`Input.${kind} not supported`)
            }
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0 && unsupported.length === 0) unsupported.push("no JSX usages found")

    for (const {node, kind} of jsxUsages) {
        const names = new Set()
        for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                unsupported.push("Input uses spread props")
                continue
            }
            const name = property.name.getText(sourceFile)
            names.add(name)
            if (name.startsWith("aria-") || name.startsWith("data-")) continue
            if (!PASSTHROUGH.has(name) && !MIGRATED.has(name)) {
                unsupported.push(`unsupported prop ${name}`)
            }
            if (name === "status" && staticString(property) === null)
                unsupported.push("status is dynamic")
            if (name === "size" && staticString(property) === null)
                unsupported.push("size is dynamic")
            if (name === "variant" && staticString(property) !== "borderless")
                unsupported.push("variant other than borderless")
            if (name === "autoSize" && staticBoolean(property) === null)
                unsupported.push("autoSize config is complex")
            if (
                (name === "prefix" || name === "suffix") &&
                (!property.initializer || !ts.isJsxExpression(property.initializer))
            )
                unsupported.push(`${name} is not a JSX expression`)
            if (
                name === "className" &&
                property.initializer &&
                !ts.isStringLiteral(property.initializer)
            ) {
                // dynamic className only blocks the wrapper treatment
                if (names.has("prefix") || names.has("suffix")) {
                    unsupported.push("prefix/suffix with dynamic className")
                }
            }
        }
        if (names.has("onPressEnter") && names.has("onKeyDown"))
            unsupported.push("onPressEnter alongside onKeyDown")
        if ((names.has("prefix") || names.has("suffix")) && names.has("className")) {
            const classAttr = node.attributes.properties.find(
                (p) => ts.isJsxAttribute(p) && p.name.getText(sourceFile) === "className",
            )
            if (classAttr?.initializer && !ts.isStringLiteral(classAttr.initializer))
                unsupported.push("prefix/suffix with dynamic className")
        }
    }

    if (unsupported.length > 0) {
        return `skipped\t${file}\t${[...new Set(unsupported)].join("; ")}`
    }

    const edits = []
    let needsTextarea = false
    let needsInput = false

    for (const {node, kind} of jsxUsages) {
        const attrs = new Map()
        for (const property of node.attributes.properties) {
            attrs.set(property.name.getText(sourceFile), property)
        }

        const passthroughText = []
        for (const [name, property] of attrs) {
            if (PASSTHROUGH.has(name) && name !== "className") {
                passthroughText.push(property.getText(sourceFile))
            }
            if (name.startsWith("aria-") || name.startsWith("data-")) {
                passthroughText.push(property.getText(sourceFile))
            }
        }

        const classes = []
        if (attrs.has("size")) {
            const cls = SIZE_CLASS[staticString(attrs.get("size"))]
            if (cls) classes.push(cls)
        }
        if (attrs.has("variant")) {
            classes.push("border-transparent bg-transparent shadow-none focus-visible:ring-0")
        }
        if (attrs.has("status")) {
            const status = staticString(attrs.get("status"))
            if (status === "error" || status === "warning") passthroughText.push("aria-invalid")
        }
        if (attrs.has("onPressEnter")) {
            const initializer = attrs.get("onPressEnter").initializer
            const expr = ts.isJsxExpression(initializer)
                ? initializer.expression.getText(sourceFile)
                : null
            if (expr) {
                passthroughText.push(
                    `onKeyDown={(e) => {\n    if (e.key === "Enter") (${expr})(e)\n}}`,
                )
            }
        }

        const prefixAttr = attrs.get("prefix")
        const suffixAttr = attrs.get("suffix")
        const hasWrap = Boolean(prefixAttr || suffixAttr)
        const origClass =
            attrs.has("className") && attrs.get("className").initializer
                ? ts.isStringLiteral(attrs.get("className").initializer)
                    ? attrs.get("className").initializer.text
                    : attrs.get("className").getText(sourceFile)
                : ""

        const tag = kind === "textarea" ? "Textarea" : "Input"
        if (kind === "textarea") needsTextarea = true
        else needsInput = true

        let replacement
        if (!hasWrap) {
            const classValue = [
                origClass && !origClass.startsWith("className") ? origClass : "",
                classes.join(" "),
            ]
                .filter(Boolean)
                .join(" ")
            let classOut = ""
            if (attrs.has("className") && !ts.isStringLiteral(attrs.get("className").initializer)) {
                // dynamic className passthrough, merged with mapped classes if any
                const exprText = attrs.get("className").initializer.expression.getText(sourceFile)
                classOut = classes.length
                    ? ` className={[${exprText}, ${JSON.stringify(classes.join(" "))}].filter(Boolean).join(" ")}`
                    : ` className={${exprText}}`
            } else if (classValue) {
                classOut = ` className=${JSON.stringify(classValue)}`
            }
            replacement = `<${tag} ${passthroughText.join(" ")}${classOut} />`
        } else {
            if (prefixAttr) classes.push("ps-8")
            if (suffixAttr) classes.push("pe-8")
            const wrapperClass = ["relative", origClass].filter(Boolean).join(" ")
            const prefixText = prefixAttr
                ? `<span className="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground [&_svg]:size-3.5">{${prefixAttr.initializer.expression.getText(sourceFile)}}</span>`
                : ""
            const suffixText = suffixAttr
                ? `<span className="absolute end-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground [&_svg]:size-3.5">{${suffixAttr.initializer.expression.getText(sourceFile)}}</span>`
                : ""
            replacement =
                `<div className=${JSON.stringify(wrapperClass)}>` +
                prefixText +
                `<${tag} ${passthroughText.join(" ")} className=${JSON.stringify(classes.join(" "))} />` +
                suffixText +
                `</div>`
        }

        edits.push({start: node.getStart(sourceFile), end: node.getEnd(), text: replacement})
    }

    let importText = ""
    if (needsInput && !source.includes('from "@agenta/primitive-ui/components/input"')) {
        importText += `import {Input} from "@agenta/primitive-ui/components/input"\n`
    }
    if (needsTextarea && !source.includes('from "@agenta/primitive-ui/components/textarea"')) {
        importText += `import {Textarea} from "@agenta/primitive-ui/components/textarea"\n`
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
