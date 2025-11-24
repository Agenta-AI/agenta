import {memo, useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import Router from "next/router"

import {navigationRequestAtom, type NavigationCommand} from "@/oss/state/appState"
import {legacyFocusDrawerEnabledAtom} from "@/oss/state/focusDrawerPreference"
import {urlQuerySyncAtom} from "@/oss/state/url/test"

const TraceDrawer = dynamic(
    () => import("@/oss/components/Playground/Components/Drawers/TraceDrawer/TraceDrawer"),
    {ssr: false},
)

const EvalRunFocusDrawer = dynamic(
    () => import("@/oss/components/EvalRunDetails/AutoEvalRun/components/EvalRunFocusDrawer"),
    {ssr: false},
)

const EvalRunFocusDrawerPreview = dynamic(
    () => import("@/oss/components/EvalRunDetails2/components/FocusDrawer"),
    {ssr: false},
)

const SelectDeployVariantModalWrapper = dynamic(
    () => import("@/oss/components/DeploymentsDashboard/modals/SelectDeployVariantModalWrapper"),
    {ssr: false},
)

const DeploymentConfirmationModalWrapper = dynamic(
    () => import("@/oss/components/DeploymentsDashboard/modals/DeploymentConfirmationModalWrapper"),
    {ssr: false},
)

const DeploymentsDrawerWrapper = dynamic(
    () => import("@/oss/components/DeploymentsDashboard/modals/DeploymentsDrawerWrapper"),
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

const CustomWorkflowModalMount = dynamic(
    () => import("@/oss/components/Modals/CustomWorkflowModalMount"),
    {ssr: false},
)

const getHashFromAsPath = (asPath: string) => {
    const hashIndex = asPath.indexOf("#")
    if (hashIndex === -1) return undefined
    return asPath.slice(hashIndex + 1)
}

const executeNavigationCommand = async (command: NavigationCommand) => {
    if (typeof window === "undefined") return

    const method = command.method ?? (command.type === "href" ? "push" : "replace")
    const shallow = command.shallow ?? true

    if (process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true") {
        console.debug("[nav] execute", command)
    }

    if (command.type === "href") {
        const action = method === "replace" ? Router.replace : Router.push
        await action(command.href, undefined, {shallow})
        return
    }

    const nextQuery: Record<string, any> = {...Router.query}
    Object.entries(command.patch).forEach(([key, value]) => {
        if (value === undefined) {
            delete nextQuery[key]
            return
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                delete nextQuery[key]
                return
            }
            nextQuery[key] = value
            return
        }
        nextQuery[key] = value
    })

    const action = method === "replace" ? Router.replace : Router.push
    const hash = command.preserveHash ? getHashFromAsPath(Router.asPath) : undefined
    await action(
        {
            pathname: Router.pathname,
            query: nextQuery,
            ...(hash ? {hash} : {}),
        },
        undefined,
        {shallow},
    )
}

const NavigationCommandListener = () => {
    const command = useAtomValue(navigationRequestAtom)
    const resetNavigation = useSetAtom(navigationRequestAtom)

    useEffect(() => {
        if (!command) return

        let cancelled = false

        const run = async () => {
            try {
                await executeNavigationCommand(command)
            } catch (error) {
                console.error("Navigation command failed:", error)
            } finally {
                if (!cancelled) {
                    resetNavigation(null)
                }
            }
        }

        void run()

        return () => {
            cancelled = true
        }
    }, [command, resetNavigation])

    return null
}

const AppGlobalWrappers = () => {
    const legacyFocusDrawerEnabled = useAtomValue(legacyFocusDrawerEnabledAtom)
    useAtomValue(urlQuerySyncAtom)
    return (
        <>
            <NavigationCommandListener />
            <TraceDrawer />
            {legacyFocusDrawerEnabled ? <EvalRunFocusDrawer /> : <EvalRunFocusDrawerPreview />}
            <DeleteAppModalWrapper />
            <EditAppModalWrapper />
            <VariantDrawerWrapper />
            <VariantComparisonModalWrapper />
            <DeleteEvaluationModalWrapper />
            <DeployVariantModalWrapper />
            <DeleteVariantModalWrapper />
            <SelectDeployVariantModalWrapper />
            <DeploymentConfirmationModalWrapper />
            <DeploymentsDrawerWrapper />
            <CustomWorkflowModalMount />
        </>
    )
}

export default memo(AppGlobalWrappers)
