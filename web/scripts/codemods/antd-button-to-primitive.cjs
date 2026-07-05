#!/usr/bin/env node
// antd Button → @agenta/primitive-ui Button. All-or-nothing per file: any usage
// the mapping can't express verbatim skips the whole file (reported), so a file
// is either fully converted or untouched.

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-button-to-primitive.cjs [--write] <path...>")
    process.exit(1)
}

const VARIANT_BY_TYPE = {
    primary: null, // primitive default
    default: "outline",
    text: "ghost",
    link: "link",
    dashed: "outline",
}
const SIZE_MAP = {small: "sm", middle: null, large: "lg"}
const ICON_SIZE_MAP = {small: "icon-sm", middle: "icon", large: "icon"}
const PASSTHROUGH_PROPS = new Set([
    "className",
    "style",
    "onClick",
    "onMouseDown",
    "onMouseUp",
    "onMouseEnter",
    "onMouseLeave",
    "onPointerDown",
    "onPointerEnter",
    "onPointerLeave",
    "onFocus",
    "onBlur",
    "onKeyDown",
    "disabled",
    "title",
    "id",
    "key",
    "role",
    "tabIndex",
    "form",
    "autoFocus",
    "ref",
    "children",
])
const MIGRATED_PROPS = new Set([
    "type",
    "danger",
    "size",
    "icon",
    "loading",
    "htmlType",
    "block",
    "shape",
    "href",
    "target",
    "rel",
])

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
    let buttonLocal
    const unsupported = []

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const specifierText = statement.moduleSpecifier.text
        if (specifierText === "antd") {
            const bindings = statement.importClause?.namedBindings
            if (!bindings || !ts.isNamedImports(bindings)) continue
            for (const element of bindings.elements) {
                const imported = element.propertyName?.text ?? element.name.text
                if (imported === "Button") {
                    importDeclaration = statement
                    importSpecifier = element
                    buttonLocal = element.name.text
                    if (element.isTypeOnly) unsupported.push("type-only Button import")
                }
                if (imported === "ButtonProps") unsupported.push("file uses antd ButtonProps")
            }
        }
        if (specifierText === "antd/es/button" || specifierText.startsWith("antd/lib/button")) {
            unsupported.push("deep antd button import")
        }
    }

    if (!buttonLocal) return null
    if (source.includes("ant-btn")) unsupported.push("contains .ant-btn CSS selector")

    const jsxUsages = []

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === buttonLocal) {
            const parent = node.parent
            const isTag =
                (ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                parent.tagName === node
            const supported = ts.isImportSpecifier(parent) || isTag
            if (!supported) unsupported.push(`non-JSX ${buttonLocal} usage`)
        }
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            ts.isIdentifier(node.tagName) &&
            node.tagName.text === buttonLocal
        ) {
            jsxUsages.push(node)
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0) unsupported.push("no JSX usages found")

    // Validate every usage before editing anything.
    for (const node of jsxUsages) {
        for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                unsupported.push("Button uses spread props")
                continue
            }
            const name = property.name.getText(sourceFile)
            if (name.startsWith("aria-") || name.startsWith("data-")) continue
            if (!PASSTHROUGH_PROPS.has(name) && !MIGRATED_PROPS.has(name)) {
                unsupported.push(`unsupported prop ${name}`)
            }
            if (name === "type" && staticString(property) === null)
                unsupported.push("type is dynamic")
            if (name === "danger" && staticBoolean(property) === null)
                unsupported.push("danger is dynamic")
            if (name === "size" && staticString(property) === null)
                unsupported.push("size is dynamic")
            if (name === "htmlType" && staticString(property) === null)
                unsupported.push("htmlType is dynamic")
            if (name === "block" && staticBoolean(property) === null)
                unsupported.push("block is dynamic")
            if (name === "shape" && staticString(property) === null)
                unsupported.push("shape is dynamic")
            if (name === "loading") {
                if (!property.initializer) continue
                if (
                    ts.isJsxExpression(property.initializer) &&
                    property.initializer.expression &&
                    ts.isObjectLiteralExpression(property.initializer.expression)
                ) {
                    unsupported.push("loading uses object config")
                }
            }
            if (
                name === "icon" &&
                (!property.initializer || !ts.isJsxExpression(property.initializer))
            )
                unsupported.push("icon is not a JSX expression")
            if ((name === "href" || name === "target" || name === "rel") && !property.initializer)
                unsupported.push(`${name} without value`)
        }
    }

    if (unsupported.length > 0) {
        return `skipped\t${file}\t${[...new Set(unsupported)].join("; ")}`
    }

    const edits = []
    let needsSpinner = false

    for (const node of jsxUsages) {
        const attrs = new Map()
        for (const property of node.attributes.properties) {
            attrs.set(property.name.getText(sourceFile), property)
        }

        // --- derive mapping ---------------------------------------------------
        const typeValue = attrs.has("type") ? staticString(attrs.get("type")) : "default"
        const danger = attrs.has("danger") ? staticBoolean(attrs.get("danger")) : false
        let variant = danger ? "destructive" : VARIANT_BY_TYPE[typeValue ?? "default"]
        if (variant === undefined) variant = "outline"

        const sizeValue = attrs.has("size")
            ? (staticString(attrs.get("size")) ?? "middle")
            : "middle"

        // icon-only: has icon prop and no meaningful children
        const parentElement = ts.isJsxSelfClosingElement(node) ? null : node.parent
        const hasRealChildren = parentElement
            ? parentElement.children.some(
                  (child) => !(ts.isJsxText(child) && child.text.trim() === ""),
              )
            : false
        const iconOnly = attrs.has("icon") && !hasRealChildren

        let sizeOut = iconOnly ? ICON_SIZE_MAP[sizeValue] : SIZE_MAP[sizeValue]
        if (sizeOut === undefined) sizeOut = null

        const classes = []
        if (typeValue === "dashed") classes.push("border-dashed")
        if (attrs.has("block") && staticBoolean(attrs.get("block"))) classes.push("w-full")
        if (attrs.has("shape")) {
            const shape = staticString(attrs.get("shape"))
            if (shape === "circle" || shape === "round") classes.push("rounded-full")
        }

        const childrenToPrepend = []
        if (attrs.has("loading")) {
            const loadingAttr = attrs.get("loading")
            const staticLoad = staticBoolean(loadingAttr)
            if (staticLoad === true) {
                needsSpinner = true
                childrenToPrepend.push("<Spinner />")
                if (!attrs.has("disabled")) {
                    edits.push({
                        start: node.attributes.end,
                        end: node.attributes.end,
                        text: " disabled",
                    })
                }
            } else if (staticLoad === false) {
                // drop silently
            } else {
                const expr = loadingAttr.initializer.expression.getText(sourceFile)
                needsSpinner = true
                childrenToPrepend.push(`{${expr} ? <Spinner /> : null}`)
                const disabledAttr = attrs.get("disabled")
                if (!disabledAttr) {
                    edits.push({
                        start: node.attributes.end,
                        end: node.attributes.end,
                        text: ` disabled={${expr}}`,
                    })
                } else if (
                    disabledAttr.initializer &&
                    ts.isJsxExpression(disabledAttr.initializer)
                ) {
                    const existing = disabledAttr.initializer.expression.getText(sourceFile)
                    edits.push({
                        start: disabledAttr.getStart(sourceFile),
                        end: disabledAttr.getEnd(),
                        text: `disabled={(${existing}) || (${expr})}`,
                    })
                }
                // bare `disabled` attr: already always disabled, nothing to merge
            }
        }
        if (attrs.has("icon")) {
            const iconAttr = attrs.get("icon")
            if (ts.isJsxExpression(iconAttr.initializer)) {
                childrenToPrepend.push(`{${iconAttr.initializer.expression.getText(sourceFile)}}`)
            }
        }

        let renderText = ""
        if (attrs.has("href")) {
            const hrefAttr = attrs.get("href")
            const hrefText = hrefAttr.initializer.getText(sourceFile)
            let targetText = ""
            if (attrs.has("target")) {
                const relText = attrs.has("rel")
                    ? attrs.get("rel").initializer.getText(sourceFile)
                    : '"noopener noreferrer"'
                targetText = ` target=${attrs.get("target").initializer.getText(sourceFile)} rel=${relText}`
            } else if (attrs.has("rel")) {
                targetText = ` rel=${attrs.get("rel").initializer.getText(sourceFile)}`
            }
            renderText = ` render={<a href=${hrefText}${targetText} />}`
        } else if (attrs.has("rel") || attrs.has("target")) {
            // rel/target without href is meaningless on a button — drop
        }

        let typeAttrText = ""
        if (attrs.has("htmlType")) {
            const htmlType = staticString(attrs.get("htmlType"))
            if (htmlType && htmlType !== "button") typeAttrText = ` type="${htmlType}"`
        }

        // --- remove migrated props --------------------------------------------
        for (const [name, property] of attrs) {
            if (MIGRATED_PROPS.has(name)) {
                edits.push({start: property.getFullStart(), end: property.getEnd(), text: ""})
            }
        }

        // --- new attributes ----------------------------------------------------
        let newAttrText = ""
        if (variant) newAttrText += ` variant="${variant}"`
        if (sizeOut) newAttrText += ` size="${sizeOut}"`
        newAttrText += typeAttrText + renderText

        // className merge
        const classText = classes.filter(Boolean).join(" ")
        const classAttribute = attrs.get("className")
        if (classText) {
            if (!classAttribute) {
                newAttrText += ` className=${JSON.stringify(classText)}`
            } else if (ts.isStringLiteral(classAttribute.initializer)) {
                edits.push({
                    start: classAttribute.getStart(sourceFile),
                    end: classAttribute.getEnd(),
                    text: `className=${JSON.stringify(`${classAttribute.initializer.text} ${classText}`)}`,
                })
            } else if (ts.isJsxExpression(classAttribute.initializer)) {
                const expression = classAttribute.initializer.expression.getText(sourceFile)
                edits.push({
                    start: classAttribute.getStart(sourceFile),
                    end: classAttribute.getEnd(),
                    text: `className={[${expression}, ${JSON.stringify(classText)}].filter(Boolean).join(" ")}`,
                })
            }
        }

        const childrenText = childrenToPrepend.join("")

        if (ts.isJsxSelfClosingElement(node)) {
            // replace `.../>` tail with new attrs + children + closing tag
            if (childrenText) {
                edits.push({
                    start: node.attributes.end,
                    end: node.getEnd(),
                    text: `${newAttrText}>${childrenText}</${buttonLocal}>`,
                })
            } else if (newAttrText) {
                edits.push({
                    start: node.attributes.end,
                    end: node.attributes.end,
                    text: newAttrText,
                })
            }
        } else {
            if (newAttrText) {
                edits.push({
                    start: node.attributes.end,
                    end: node.attributes.end,
                    text: newAttrText,
                })
            }
            if (childrenText) {
                edits.push({start: node.getEnd(), end: node.getEnd(), text: childrenText})
            }
        }
    }

    // --- imports ----------------------------------------------------------------
    const localName = buttonLocal === "Button" ? "Button" : `Button as ${buttonLocal}`
    let importText = `import {${localName}} from "@agenta/primitive-ui/components/button"\n`
    if (needsSpinner && !source.includes('from "@agenta/primitive-ui/components/spinner"')) {
        importText += `import {Spinner} from "@agenta/primitive-ui/components/spinner"\n`
    }
    edits.push({
        start: importDeclaration.getStart(sourceFile),
        end: importDeclaration.getStart(sourceFile),
        text: importText,
    })
    const rebuilt = rebuildAntdImport(importDeclaration, importSpecifier)
    edits.push({
        start: importDeclaration.getStart(sourceFile),
        end: importDeclaration.getEnd(),
        text: rebuilt,
    })

    edits.sort((a, b) => b.start - a.start || b.end - a.end)
    let output = source
    for (const edit of edits)
        output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
    // collapse an emptied antd import line
    output = output.replace(/^\n(?=import)/m, "\n")
    if (WRITE) fs.writeFileSync(file, output)
    return `${WRITE ? "updated" : "would update"}\t${file}\t${jsxUsages.length} usages`
}

for (const file of files) {
    const result = transform(file)
    if (result) console.log(result)
}
