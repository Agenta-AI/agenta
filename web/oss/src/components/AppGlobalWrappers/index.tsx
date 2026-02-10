import {memo, useEffect} from "react"

import {
    completionServiceSchemaAtom,
    chatServiceSchemaAtom,
} from "@agenta/entities/appRevision/state"
import {serviceSchemaMetadataWarmerAtom} from "@agenta/entities/legacyAppRevision"
import {setUserAtoms} from "@agenta/entities/shared/user"
// import {} from "@agenta/entity-ui/modals"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import Router from "next/router"

import {navigationRequestAtom, type NavigationCommand} from "@/oss/state/appState"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {urlQuerySyncAtom} from "@/oss/state/url/test"
import {workspaceMembersAtom} from "@/oss/state/workspace/atoms/selectors"

// Initialize user atoms for @agenta/entities shared user resolution
// This enables UserAuthorLabel and other user resolution features
setUserAtoms({
    membersAtom: workspaceMembersAtom,
    currentUserAtom: userAtom,
})

const EntityModalsProvider = dynamic(
    () => import("@agenta/entity-ui/modals").then((m) => m.EntityModalsProvider),
    {ssr: false},
)

const TraceDrawer = dynamic(
    () => import("@/oss/components/SharedDrawers/TraceDrawer/components/TraceDrawer"),
    {ssr: false},
)

const EvalRunFocusDrawerPreview = dynamic(
    () => import("@/oss/components/EvalRunDetails/components/FocusDrawer"),
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
        import("@/oss/components/VariantsComponents/Modals/VariantComparisonModal/VariantComparisonModalWrapper"),
    {ssr: false},
)

const DeleteEvaluationModalWrapper = dynamic(
    () => import("@/oss/components/DeleteEvaluationModal/DeleteEvaluationModalWrapper"),
    {ssr: false},
)

const DeployVariantModalWrapper = dynamic(
    () =>
        import("@/oss/components/Playground/Components/Modals/DeployVariantModal/DeployVariantModalWrapper"),
    {ssr: false},
)

const DeleteVariantModalWrapper = dynamic(
    () =>
        import("@/oss/components/Playground/Components/Modals/DeleteVariantModal/DeleteVariantModalWrapper"),
    {ssr: false},
)

const CustomWorkflowModalMount = dynamic(
    () => import("@/oss/components/CustomWorkflow/CustomWorkflowModalMount"),
    {ssr: false},
)

const OnboardingWidget = dynamic(
    () => import("@/oss/components/Onboarding/Widget/OnboardingWidget"),
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
    useAtomValue(urlQuerySyncAtom)

    // Eagerly prefetch service schemas for completion/chat apps.
    // These atoms use atomWithQuery — subscribing here triggers the fetch
    // at app startup rather than waiting until a revision is selected.
    useAtomValue(completionServiceSchemaAtom)
    useAtomValue(chatServiceSchemaAtom)

    // Pre-heat metadata for service schemas as soon as they resolve.
    // This ensures UI controls have metadata available on first paint
    // when a variant drawer opens, without waiting for per-revision derivation.
    useAtomValue(serviceSchemaMetadataWarmerAtom)

    return (
        <EntityModalsProvider>
            <NavigationCommandListener />
            <TraceDrawer />
            <EvalRunFocusDrawerPreview />
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
            <OnboardingWidget />
        </EntityModalsProvider>
    )
}

export default memo(AppGlobalWrappers)
