import {useAtomValue, useSetAtom} from "jotai"

import {closeDeployVariantModalAtom, deployVariantModalAtom} from "./store/deployVariantModalStore"

import DeployVariantModal from "./index"

const DeployVariantModalWrapper = () => {
    const state = useAtomValue(deployVariantModalAtom)
    const close = useSetAtom(closeDeployVariantModalAtom)

    return (
        <DeployVariantModal
            open={state.open}
            onCancel={() => close()}
            parentVariantId={state.parentVariantId}
            revisionId={state.revisionId}
            variantName={state.variantName}
            revision={state.revision}
            mutate={state.mutate}
        />
    )
}

export default DeployVariantModalWrapper
