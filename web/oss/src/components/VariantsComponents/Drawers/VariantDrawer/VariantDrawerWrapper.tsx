import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {variantDrawerAtom, closeVariantDrawerAtom} from "./store/variantDrawerStore"

import VariantDrawer from "./index"

const VariantDrawerWrapper = () => {
    const drawerState = useAtomValue(variantDrawerAtom)
    const closeDrawer = useSetAtom(closeVariantDrawerAtom)

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    return (
        <VariantDrawer
            open={drawerState.open}
            onClose={handleClose}
            type={drawerState.type}
            revert={drawerState.revert}
        />
    )
}

export default VariantDrawerWrapper
