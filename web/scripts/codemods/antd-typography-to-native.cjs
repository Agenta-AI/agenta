#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const ts = require("../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript")

const WRITE = process.argv.includes("--write")
const ROOTS = process.argv.filter((value) => !value.startsWith("--")).slice(2)
const COMPONENTS = new Set(["Text", "Title", "Paragraph", "Link"])
const NATIVE_TAG = {Root: "span", Text: "span", Title: "h1", Paragraph: "p", Link: "a"}
const TYPE_CLASS = {
    secondary: "text-muted-foreground",
    danger: "text-destructive",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
}
const TITLE_CLASS = {
    1: "text-2xl font-semibold leading-tight",
    2: "text-xl font-semibold leading-tight",
    3: "text-lg font-semibold leading-snug",
    4: "text-base font-semibold leading-snug",
    5: "text-sm font-semibold leading-normal",
    6: "text-sm font-semibold leading-normal",
}
const ALLOWED_NATIVE_PROPS = new Set([
    "className",
    "style",
    "title",
    "href",
    "target",
    "rel",
    "onClick",
    "onMouseDown",
    "onMouseUp",
    "onPointerDown",
    "id",
    "role",
    "tabIndex",
    "key",
    "dir",
])
const MIGRATED_PROPS = new Set([
    "type",
    "strong",
    "italic",
    "underline",
    "delete",
    "code",
    "ellipsis",
    "level",
])

if (ROOTS.length === 0) {
    console.error("Usage: node scripts/codemods/antd-typography-to-native.cjs [--write] <path...>")
    process.exit(1)
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

function staticNumber(attribute) {
    if (!attribute.initializer) return null
    if (ts.isStringLiteral(attribute.initializer)) return Number(attribute.initializer.text)
    if (ts.isJsxExpression(attribute.initializer)) {
        const expression = attribute.initializer.expression
        if (expression && ts.isNumericLiteral(expression)) return Number(expression.text)
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
    const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    let importDeclaration
    let importSpecifier
    let typographyLocal

    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "antd")
            continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        const match = bindings.elements.find(
            (element) => (element.propertyName?.text ?? element.name.text) === "Typography",
        )
        if (match) {
            importDeclaration = statement
            importSpecifier = match
            typographyLocal = match.name.text
            break
        }
    }

    if (!typographyLocal) return null

    const aliases = new Map()
    const destructuringStatements = []
    const unsupported = []
    if (source.includes("ant-typography")) unsupported.push("contains antd Typography CSS selector")

    function discover(node) {
        if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isIdentifier(node.initializer) &&
            node.initializer.text === typographyLocal &&
            ts.isObjectBindingPattern(node.name)
        ) {
            const statement = node.parent?.parent
            if (
                !statement ||
                !ts.isVariableStatement(statement) ||
                node.parent.declarations.length !== 1
            ) {
                unsupported.push("multi-declaration Typography destructuring")
                return
            }
            for (const element of node.name.elements) {
                const component =
                    element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile)
                const local = element.name.getText(sourceFile)
                if (!COMPONENTS.has(component) || !ts.isIdentifier(element.name)) {
                    unsupported.push(
                        `unsupported Typography binding ${element.getText(sourceFile)}`,
                    )
                    continue
                }
                aliases.set(local, component)
            }
            destructuringStatements.push(statement)
        }
        ts.forEachChild(node, discover)
    }
    discover(sourceFile)

    const jsxUsages = []

    function componentForTag(tagName) {
        if (ts.isIdentifier(tagName)) {
            if (tagName.text === typographyLocal) return "Root"
            return aliases.get(tagName.text)
        }
        const text = tagName.getText(sourceFile)
        if (text.startsWith(`${typographyLocal}.`)) {
            const component = text.slice(typographyLocal.length + 1)
            return COMPONENTS.has(component) ? component : undefined
        }
        return undefined
    }

    function inspect(node) {
        if (ts.isIdentifier(node) && node.text === typographyLocal) {
            const parent = node.parent
            const supported =
                ts.isImportSpecifier(parent) ||
                (ts.isVariableDeclaration(parent) && parent.initializer === node) ||
                ((ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                    parent.tagName === node) ||
                (ts.isPropertyAccessExpression(parent) &&
                    parent.expression === node &&
                    COMPONENTS.has(parent.name.text))
            if (!supported) unsupported.push(`non-JSX ${typographyLocal} usage`)
        }

        if (ts.isIdentifier(node) && aliases.has(node.text)) {
            const parent = node.parent
            const supported =
                ts.isBindingElement(parent) ||
                (ts.isPropertyAccessExpression(parent) &&
                    parent.name === node &&
                    ts.isIdentifier(parent.expression) &&
                    parent.expression.text === typographyLocal) ||
                ((ts.isJsxOpeningElement(parent) ||
                    ts.isJsxClosingElement(parent) ||
                    ts.isJsxSelfClosingElement(parent)) &&
                    parent.tagName === node)
            if (!supported) unsupported.push(`non-JSX ${node.text} usage`)
        }

        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const component = componentForTag(node.tagName)
            if (component) jsxUsages.push({node, component})
        }
        ts.forEachChild(node, inspect)
    }
    inspect(sourceFile)

    if (jsxUsages.length === 0) unsupported.push("no JSX usages found")

    for (const {node, component} of jsxUsages) {
        for (const property of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(property)) {
                unsupported.push(`${component} uses spread props`)
                continue
            }
            const name = property.name.getText(sourceFile)
            if (name.startsWith("aria-") || name.startsWith("data-")) continue
            if (!ALLOWED_NATIVE_PROPS.has(name) && !MIGRATED_PROPS.has(name)) {
                unsupported.push(`${component} uses unsupported prop ${name}`)
            }
            if (["copyable", "editable"].includes(name)) {
                unsupported.push(`${component} uses behavioral prop ${name}`)
            }
            if (["strong", "italic", "underline", "delete", "code"].includes(name)) {
                if (staticBoolean(property) === null) unsupported.push(`${name} is dynamic`)
            }
            if (name === "type" && staticString(property) === null)
                unsupported.push("type is dynamic")
            if (name === "level" && staticNumber(property) === null)
                unsupported.push("level is dynamic")
            if (name === "ellipsis" && staticBoolean(property) === null) {
                unsupported.push("ellipsis is complex")
            }
        }
    }

    if (unsupported.length > 0) {
        return `skipped\t${file}\t${[...new Set(unsupported)].join("; ")}`
    }

    const edits = []
    function addTagEdit(tagName, component, openingNode) {
        let tag = NATIVE_TAG[component]
        if (component === "Title" && openingNode) {
            const levelAttribute = openingNode.attributes.properties.find(
                (property) =>
                    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "level",
            )
            const level = levelAttribute ? staticNumber(levelAttribute) : 1
            tag = `h${Math.min(6, Math.max(1, level ?? 1))}`
        }
        edits.push({start: tagName.getStart(sourceFile), end: tagName.getEnd(), text: tag})
    }

    function visitTags(node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const component = componentForTag(node.tagName)
            if (component) {
                addTagEdit(node.tagName, component, node)
                const classes = []
                let classAttribute
                for (const property of node.attributes.properties) {
                    if (!ts.isJsxAttribute(property)) continue
                    const name = property.name.getText(sourceFile)
                    if (name === "className") {
                        classAttribute = property
                        continue
                    }
                    if (!MIGRATED_PROPS.has(name)) continue
                    edits.push({start: property.getFullStart(), end: property.getEnd(), text: ""})
                    if (name === "type") classes.push(TYPE_CLASS[staticString(property)] ?? "")
                    if (name === "strong" && staticBoolean(property)) classes.push("font-semibold")
                    if (name === "italic" && staticBoolean(property)) classes.push("italic")
                    if (name === "underline" && staticBoolean(property)) classes.push("underline")
                    if (name === "delete" && staticBoolean(property)) classes.push("line-through")
                    if (name === "code" && staticBoolean(property)) {
                        classes.push("rounded bg-muted px-1 py-0.5 font-mono text-sm")
                    }
                    if (name === "ellipsis" && staticBoolean(property)) classes.push("truncate")
                }
                if (component === "Title") {
                    const levelAttribute = node.attributes.properties.find(
                        (property) =>
                            ts.isJsxAttribute(property) &&
                            property.name.getText(sourceFile) === "level",
                    )
                    const level = levelAttribute ? staticNumber(levelAttribute) : 1
                    classes.unshift(TITLE_CLASS[level ?? 1])
                }
                const classText = classes.filter(Boolean).join(" ")
                if (classText) {
                    if (!classAttribute) {
                        edits.push({
                            start: node.attributes.end,
                            end: node.attributes.end,
                            text: ` className=${JSON.stringify(classText)}`,
                        })
                    } else if (ts.isStringLiteral(classAttribute.initializer)) {
                        edits.push({
                            start: classAttribute.getStart(sourceFile),
                            end: classAttribute.getEnd(),
                            text: `className=${JSON.stringify(`${classAttribute.initializer.text} ${classText}`)}`,
                        })
                    } else if (ts.isJsxExpression(classAttribute.initializer)) {
                        const expression = classAttribute.initializer.expression.getText(sourceFile)
                        const text = `className={[${expression}, ${JSON.stringify(classText)}].filter(Boolean).join(" ")}`
                        edits.push({
                            start: classAttribute.getStart(sourceFile),
                            end: classAttribute.getEnd(),
                            text,
                        })
                    }
                }
            }
        } else if (ts.isJsxClosingElement(node)) {
            const component = componentForTag(node.tagName)
            if (component) addTagEdit(node.tagName, component, node.parent.openingElement)
        }
        ts.forEachChild(node, visitTags)
    }
    visitTags(sourceFile)

    for (const statement of new Set(destructuringStatements)) {
        edits.push({start: statement.getFullStart(), end: statement.getEnd(), text: ""})
    }
    edits.push({
        start: importDeclaration.getStart(sourceFile),
        end: importDeclaration.getEnd(),
        text: rebuildAntdImport(importDeclaration, importSpecifier),
    })

    edits.sort((a, b) => b.start - a.start)
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
