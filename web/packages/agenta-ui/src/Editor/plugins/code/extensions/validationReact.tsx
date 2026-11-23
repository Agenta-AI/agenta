import {
    createElement,
    type ComponentType,
    type MouseEvent,
    useState,
    useSyncExternalStore,
} from "react"

import {useT} from "@agenta/i18n"
import uiEditorCatalog from "@agenta/i18n/catalogs/ui.editor"
import {useFloating, autoUpdate, flip, offset, shift} from "@floating-ui/react"
import {ExtensionComponent} from "@lexical/react/ExtensionComponent"
import {ReactExtension} from "@lexical/react/ReactExtension"
import {useExtensionDependency} from "@lexical/react/useExtensionComponent"
import {configExtension, defineExtension} from "lexical"
import {createPortal} from "react-dom"

import type {ErrorInfo} from "../core/validation/types"

import {ValidationCoreExtension} from "./validationCore"

function ErrorTooltip({errors}: {errors: ErrorInfo[]}) {
    const t = useT(uiEditorCatalog)
    const groupedErrors = errors.reduce(
        (groups, error) => {
            const key = `${error.type}:${error.message}`
            if (!groups[key]) {
                groups[key] = {
                    ...error,
                    lines: [],
                }
            }
            if (error.line) {
                groups[key].lines.push(error.line)
            }
            return groups
        },
        {} as Record<string, ErrorInfo & {lines: number[]}>,
    )

    const uniqueErrors = Object.values(groupedErrors)

    return (
        <div className="bg-popover text-popover-foreground text-meta rounded-lg shadow-overlay p-3 max-w-sm">
            <div className="font-semibold mb-2 text-meta">
                {t("ui.editor.errorCount", {count: uniqueErrors.length})}
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
                {uniqueErrors.map((error, index) => {
                    const sortedLines = error.lines.sort((a, b) => a - b)
                    const lineDisplay =
                        sortedLines.length > 1
                            ? `Lines ${Math.min(...sortedLines)}-${Math.max(...sortedLines)}`
                            : sortedLines.length === 1
                              ? `Line ${sortedLines[0]}`
                              : ""

                    return (
                        <div
                            key={`${error.type}-${index}`}
                            className="border-0 border-l border-solid border-destructive pl-2"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-destructive font-medium capitalize text-meta">
                                    {error.type}
                                </span>
                                {lineDisplay && (
                                    <span className="text-muted-foreground text-caption">{lineDisplay}</span>
                                )}
                            </div>
                            <div className="mt-1 text-foreground text-meta">{error.message}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function ErrorIndicator({
    errorCount,
    onMouseEnter,
    onMouseLeave,
}: {
    errorCount: number
    onMouseEnter: (e: MouseEvent) => void
    onMouseLeave: () => void
}) {
    return (
        <div
            className="absolute top-2 right-2 z-10 cursor-pointer"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="relative">
                <div className="w-6 h-6 bg-destructive rounded-md flex items-center justify-center text-background text-caption font-semibold">
                    !
                </div>
                {errorCount > 1 && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-sm flex items-center justify-center text-background text-caption font-semibold">
                        {errorCount > 9 ? "9+" : errorCount}
                    </div>
                )}
            </div>
        </div>
    )
}

function ValidationOverlay() {
    const {output} = useExtensionDependency(ValidationCoreExtension)
    const [showTooltip, setShowTooltip] = useState(false)
    const snapshot = useSyncExternalStore(output.subscribe, output.getSnapshot, output.getSnapshot)

    const {refs, floatingStyles} = useFloating({
        middleware: [offset(10), flip(), shift()],
        whileElementsMounted: autoUpdate,
    })

    if (snapshot.state.errors.length === 0 || !snapshot.container) {
        return null
    }

    const uniqueErrorsCount = Object.keys(
        snapshot.state.errors.reduce(
            (groups, error) => {
                const key = `${error.type}:${error.message}`
                groups[key] = true
                return groups
            },
            {} as Record<string, boolean>,
        ),
    ).length

    const handleMouseEnter = (e: MouseEvent) => {
        refs.setReference(e.currentTarget as HTMLElement)
        setShowTooltip(true)
    }

    const handleMouseLeave = () => {
        setShowTooltip(false)
    }

    return createPortal(
        <>
            <ErrorIndicator
                errorCount={uniqueErrorsCount}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            />
            {showTooltip && (
                <div ref={refs.setFloating} style={floatingStyles} className="z-50">
                    <ErrorTooltip errors={snapshot.state.errors} />
                </div>
            )}
        </>,
        snapshot.container,
    )
}

export const ValidationReactExtension = defineExtension({
    name: "@agenta/editor/code/ValidationReact",
    dependencies: [ValidationCoreExtension],
    build: () => ({Component: ValidationOverlay}),
})

function ValidationDecorator() {
    const ExtensionComponentWithNamespace = ExtensionComponent as unknown as ComponentType<{
        "lexical:extension": typeof ValidationReactExtension
    }>

    return createElement(ExtensionComponentWithNamespace, {
        "lexical:extension": ValidationReactExtension,
    })
}

export const ValidationExtension = defineExtension({
    name: "@agenta/editor/code/Validation",
    dependencies: [
        ValidationReactExtension,
        configExtension(ReactExtension, {
            decorators: [ValidationDecorator],
        }),
    ],
})
