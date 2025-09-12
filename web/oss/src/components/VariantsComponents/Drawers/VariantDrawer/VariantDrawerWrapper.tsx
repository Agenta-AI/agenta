import {useCallback, useEffect, useRef} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {recentRevisionsAtom} from "@/oss/state/variant/selectors/variant"

import {
    variantDrawerAtom,
    closeVariantDrawerAtom,
    variantDrawerVariantsAtom,
    openVariantDrawerAtom,
} from "./store/variantDrawerStore"

import VariantDrawer from "./index"

const VariantDrawerWrapper = () => {
    const router = useRouter()
    const drawerState = useAtomValue(variantDrawerAtom)
    const closeDrawer = useSetAtom(closeVariantDrawerAtom)
    const openDrawer = useSetAtom(openVariantDrawerAtom)
    const variants = useAtomValue(variantDrawerVariantsAtom)
    const [queryVariant] = useQueryParam("revisions")
    const previousPathnameRef = useRef(router.pathname)

    // Handle closing drawer and clearing URL parameter
    const handleClose = useCallback(() => {
        // Only close the drawer; URL param will be cleared on unmount to avoid content flicker
        closeDrawer()
    }, [closeDrawer])

    useEffect(() => {
        // Close drawer when user navigates to a new page (if drawer is open)
        const currentPathname = router.pathname
        const previousPathname = previousPathnameRef.current

        // Only close if pathname actually changed AND drawer is open
        if (currentPathname !== previousPathname && drawerState.open) {
            closeDrawer()
        }

        // Update the ref with current pathname
        previousPathnameRef.current = currentPathname
    }, [router.pathname, drawerState.open, closeDrawer])

    // One-time deep link handling: open on initial mount if URL has revisions
    const didInitRef = useRef(false)
    useEffect(() => {
        if (didInitRef.current) return
        didInitRef.current = true

        const isPlaygroundRoute = router.pathname.includes("/playground")
        if (isPlaygroundRoute) return

        if (queryVariant && !drawerState.open && !drawerState.variantsAtom) {
            openDrawer({
                type: "variant",
                variantsAtom: recentRevisionsAtom,
            })
        }
        // After this point, URL changes are cosmetic only and do not drive drawer state
    }, [router.pathname])

    // VariantDrawer variants passed to component
    return (
        <VariantDrawer
            open={drawerState.open}
            onClose={handleClose}
            variants={variants}
            type={drawerState.type}
            revert={drawerState.revert}
        />
    )
}

export default VariantDrawerWrapper
