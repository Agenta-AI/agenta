import {memo} from "react"

import dynamic from "next/dynamic"

const TraceDrawer = dynamic(
    () => import("@/oss/components/Playground/Components/Drawers/TraceDrawer/TraceDrawer"),
    {ssr: false},
)

const DeleteAppModalWrapper = dynamic(
    () => import("@/oss/components/pages/app-management/modals/DeleteAppModal"),
    {ssr: false},
)

const EditAppModalWrapper = dynamic(
    () => import("@/oss/components/pages/app-management/modals/EditAppModal"),
    {ssr: false},
)

const VariantDrawerWrapper = dynamic(
    () => import("@/oss/components/VariantsComponents/Drawers/VariantDrawer/VariantDrawerWrapper"),
    {ssr: false},
)

const VariantComparisonModalWrapper = dynamic(
    () =>
        import(
            "@/oss/components/VariantsComponents/Modals/VariantComparisonModal/VariantComparisonModalWrapper"
        ),
    {ssr: false},
)

const DeleteEvaluationModalWrapper = dynamic(
    () => import("@/oss/components/DeleteEvaluationModal/DeleteEvaluationModalWrapper"),
    {ssr: false},
)

const DeployVariantModalWrapper = dynamic(
    () =>
        import(
            "@/oss/components/Playground/Components/Modals/DeployVariantModal/DeployVariantModalWrapper"
        ),
    {ssr: false},
)

const DeleteVariantModalWrapper = dynamic(
    () =>
        import(
            "@/oss/components/Playground/Components/Modals/DeleteVariantModal/DeleteVariantModalWrapper"
        ),
    {ssr: false},
)

const PlaygroundNavigator = dynamic(
    () => import("@/oss/components/AppGlobalWrappers/PlaygroundNavigator"),
    {ssr: false},
)

const CustomWorkflowModalMount = dynamic(
    () => import("@/oss/components/Modals/CustomWorkflowModalMount"),
    {ssr: false},
)

const AppGlobalWrappers = () => {
    return (
        <>
            <TraceDrawer />
            <DeleteAppModalWrapper />
            <EditAppModalWrapper />
            <VariantDrawerWrapper />
            <VariantComparisonModalWrapper />
            <DeleteEvaluationModalWrapper />
            <DeployVariantModalWrapper />
            <DeleteVariantModalWrapper />
            <PlaygroundNavigator />
            <CustomWorkflowModalMount />
        </>
    )
}

export default memo(AppGlobalWrappers)
