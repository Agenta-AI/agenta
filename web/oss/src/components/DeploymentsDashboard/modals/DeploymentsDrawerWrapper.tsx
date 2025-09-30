import {useAtom, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import DeploymentsDrawer from "@/oss/components/DeploymentsDashboard/components/Drawer"
import {
    closeDeploymentsDrawerAtom,
    deploymentsDrawerStateAtom,
} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"

const DeploymentsDrawerWrapper = () => {
    const [state] = useAtom(deploymentsDrawerStateAtom)
    const close = useSetAtom(closeDeploymentsDrawerAtom)

    return (
        <DeploymentsDrawer
            open={state.open}
            onClose={() => close()}
            initialWidth={state.initialWidth}
            drawerVariantId={state.revisionId}
            selectedRevisionId={state.deploymentRevisionId}
            envName={state.envName}
        />
    )
}

export default dynamic(() => Promise.resolve(DeploymentsDrawerWrapper), {ssr: false})
