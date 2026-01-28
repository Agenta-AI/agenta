import {useCallback, useEffect, useMemo, useState} from "react"

import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useAppState, useQueryParamState} from "@/oss/state/appState"
import {clearVariantQueryParam} from "@/oss/state/url/test"

import DeploymentDrawerTitle from "./assets/DeploymentDrawerTitle"
import type {VariantDrawerProps, ViewType} from "./assets/types"
import VariantDrawerContent from "./assets/VariantDrawerContent"
import VariantDrawerTitle from "./assets/VariantDrawerTitle"
import {variantDrawerAtom, variantDrawerVariantsAtom} from "./store/variantDrawerStore"

const drawerSelectedVariantIdAtom = selectAtom(
    variantDrawerAtom,
    (state) => state.selectedVariantId,
    (a, b) => a === b,
)

const EMPTY_VARIANT_IDS = []

const VariantDrawer = ({variants: propsVariants, type, revert, ...props}: VariantDrawerProps) => {
    const storedVariantId = useAtomValue(drawerSelectedVariantIdAtom)
    const defaultVariants = useAtomValue(variantDrawerVariantsAtom) || []
    const variants = propsVariants ?? defaultVariants
    const [queryVariant] = useQueryParamState("revisionId")
    const appState = useAppState()
    const rawQueryVariant = useMemo(() => {
        const legacyValue = appState.query?.revisions as any
        return queryVariant ?? legacyValue
    }, [appState.query?.revisions, queryVariant])
    // Robust parsing: revisions can be a plain id string, a JSON array string, or an array
    const urlSelectedVariantId = useMemo(() => {
        const value: any = rawQueryVariant as any
        if (Array.isArray(value)) {
            return value[0]
        }
        if (typeof value === "string") {
            const trimmed = value.trim()
            if (!trimmed) return undefined
            // Still support legacy JSON array deep links for backwards compatibility
            if (trimmed.startsWith("[")) {
                try {
                    const parsed = JSON.parse(trimmed)
                    if (Array.isArray(parsed)) {
                        return parsed[0]
                    }
                } catch {
                    return undefined
                }
            }
            return trimmed
        }
        return undefined
    }, [rawQueryVariant])

    const selectedVariantId = storedVariantId ?? urlSelectedVariantId

    const [viewAs, setViewAs] = useState<ViewType>("prompt")
    const [showOriginal, setShowOriginal] = useState<boolean>(false)

    const routerRevisions = useMemo(() => {
        // Skip URL processing on playground route to avoid conflicts
        const isPlaygroundRoute = appState.pathname.includes("/playground")
        if (isPlaygroundRoute || !rawQueryVariant) return []

        const raw: any = rawQueryVariant as any
        if (Array.isArray(raw)) return raw

        if (typeof raw === "string") {
            const val = raw.trim()
            if (!val) return []
            if (val.startsWith("[")) {
                try {
                    const parsed = JSON.parse(val)
                    return Array.isArray(parsed) ? (parsed as string[]) : EMPTY_VARIANT_IDS
                } catch {
                    return EMPTY_VARIANT_IDS
                }
            }
            if (val.includes(",")) {
                return val
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
            }
            return [val]
        }

        return EMPTY_VARIANT_IDS
    }, [appState.pathname, rawQueryVariant])

    const {width: incomingWidth, ...restProps} = props
    const initialWidth = incomingWidth ?? 1100
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    const onClose = useCallback(() => {
        props.onClose?.({} as any)
    }, [props.onClose])

    const handleAfterOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                clearVariantQueryParam()
            }
            props.afterOpenChange?.(nextOpen)
        },
        [props.afterOpenChange],
    )

    const onChangeViewAs = useCallback((view: ViewType) => {
        setViewAs(view)
    }, [])

    // Ensure we do not carry over "Original" state when switching to a clean revision
    useEffect(() => {
        setShowOriginal(false)
    }, [selectedVariantId])

    const toggleWidth = useCallback(() => {
        setDrawerWidth((width) => (width === initialWidth ? 1920 : initialWidth))
    }, [initialWidth])

    return (
        <EnhancedDrawer
            {...restProps}
            closeIcon={null}
            width={drawerWidth}
            mask={false}
            onClose={onClose}
            afterOpenChange={handleAfterOpenChange}
            classNames={{body: "!p-0"}}
            data-tour="variant-drawer"
            title={
                type === "variant" ? (
                    <VariantDrawerTitle
                        variantId={selectedVariantId}
                        onClose={onClose}
                        variantIds={routerRevisions?.length ? routerRevisions : undefined}
                        variants={variants}
                        viewAs={viewAs}
                        onToggleWidth={toggleWidth}
                        isExpanded={drawerWidth !== initialWidth}
                    />
                ) : (
                    <DeploymentDrawerTitle
                        variantId={selectedVariantId}
                        onClose={onClose}
                        revert={revert}
                        onToggleWidth={toggleWidth}
                        isExpanded={drawerWidth !== initialWidth}
                    />
                )
            }
        >
            <VariantDrawerContent
                variantId={selectedVariantId}
                type={type}
                viewAs={viewAs}
                onChangeViewAs={onChangeViewAs}
                showOriginal={showOriginal}
                onToggleOriginal={setShowOriginal}
            />
        </EnhancedDrawer>
    )
}

export default VariantDrawer
