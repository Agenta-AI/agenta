import {useAtomValue} from "jotai"

import {deploymentsDrawerStateAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"

const DrawerTitle = ({children}: {children?: React.ReactNode}) => {
    const {mode, envName} = useAtomValue(deploymentsDrawerStateAtom)
    const title = mode === "variant" ? "Fetching by Variant" : envName || ""
    return <div className="flex-1 text-base font-medium leading-6">{children ?? title}</div>
}

export default DrawerTitle
