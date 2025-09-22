import {useCallback, useEffect, useMemo, useState} from "react"

import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import {useRouter} from "next/router"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

import DeploymentDrawerTitle from "./assets/DeploymentDrawerTitle"
import type {VariantDrawerProps, ViewType} from "./assets/types"
import VariantDrawerContent from "./assets/VariantDrawerContent"
import VariantDrawerTitle from "./assets/VariantDrawerTitle"
import {variantDrawerAtom} from "./store/variantDrawerStore"

const drawerSelectedVariantIdAtom = selectAtom(
    variantDrawerAtom,
    (state) => state.selectedVariantId,
    (a, b) => a === b,
)

const VariantDrawer = ({variants: propsVariants, type, revert, ...props}: VariantDrawerProps) => {
    const allVariants = useAtomValue(revisionListAtom)
    const storedVariantId = useAtomValue(drawerSelectedVariantIdAtom)
    const variants = propsVariants || allVariants
    const [queryVariant] = useQueryParam("revisions")
    // Robust parsing: revisions can be a plain id string, a JSON array string, or an array
    const urlSelectedVariantId = useMemo(() => {
        const value: any = queryVariant as any
        if (Array.isArray(value)) {
            return value[0]
        }
        if (typeof value === "string") {
            // Try to parse JSON array string, otherwise treat as plain id
            try {
                const parsed = JSON.parse(value)
                if (Array.isArray(parsed)) return parsed[0]
            } catch {
                // Not JSON, treat value as single id
                return value
            }
        }
        return undefined
    }, [queryVariant])
    const router = useRouter()

    const selectedVariantId = storedVariantId ?? urlSelectedVariantId

    const [viewAs, setViewAs] = useState<ViewType>("prompt")
    const [showOriginal, setShowOriginal] = useState<boolean>(false)

    const routerRevisions = useMemo(() => {
        // Skip URL processing on playground route to avoid conflicts
        const isPlaygroundRoute = router.pathname.includes("/playground")
        if (isPlaygroundRoute || !router.query.revisions) return []

        const raw = router.query.revisions as any
        // Already an array
        if (Array.isArray(raw)) return raw

        if (typeof raw === "string") {
            const val = raw.trim()
            // JSON array string
            if (val.startsWith("[")) {
                try {
                    const parsed = JSON.parse(val)
                    return Array.isArray(parsed) ? parsed : []
                } catch {
                    return []
                }
            }
            // Comma separated values or single id
            if (val.includes(",")) {
                return val
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
            }
            return [val]
        }

        return []
    }, [router.query.revisions, router.pathname])

    const onClose = useCallback(() => {
        props.onClose?.({} as any)
    }, [props.onClose])

    const onChangeViewAs = useCallback((view: ViewType) => {
        setViewAs(view)
    }, [])

    // Ensure we do not carry over "Original" state when switching to a clean revision
    useEffect(() => {
        setShowOriginal(false)
    }, [selectedVariantId])

    return (
        <EnhancedDrawer
            {...props}
            closeIcon={null}
            width={1100}
            mask={false}
            onClose={onClose}
            classNames={{body: "!p-0"}}
            title={
                type === "variant" ? (
                    <VariantDrawerTitle
                        variantId={selectedVariantId}
                        onClose={onClose}
                        variants={variants || []}
                        variantIds={routerRevisions?.length ? routerRevisions : undefined}
                        viewAs={viewAs}
                    />
                ) : (
                    <DeploymentDrawerTitle
                        variantId={selectedVariantId}
                        onClose={onClose}
                        revert={revert}
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
