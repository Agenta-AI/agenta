import {useCallback, useEffect, useMemo} from "react"
import dynamic from "next/dynamic"

import type {VariantDrawerProps} from "./assets/types"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {useRouter} from "next/router"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {PlaygroundStateData} from "@/oss/lib/hooks/useStatelessVariants/types"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {useAppId} from "@/oss/hooks/useAppId"
import {findVariantById} from "./utils"

const VariantDrawerContent = dynamic(() => import("./assets/VariantDrawerContent"), {ssr: false})
const VariantDrawerTitle = dynamic(() => import("./assets/VariantDrawerTitle"), {ssr: false})
const DeploymentDrawerTitle = dynamic(() => import("./assets/DeploymentDrawerTitle"), {ssr: false})

const VariantDrawer = ({variants, type, revert, ...props}: VariantDrawerProps) => {
    const appId = useAppId()
    const [queryVariant, setQueryVariant] = useQueryParam("revisions")
    const router = useRouter()
    const {environments} = useEnvironments({appId})

    const selectedDrawerVariant = useMemo(() => {
        if (!queryVariant) return undefined

        const targetId = JSON.parse(queryVariant)[0] as string
        return findVariantById(variants ?? [], targetId)
    }, [queryVariant, variants])

    const onClose = useCallback(() => {
        props.onClose?.({} as any)
        setQueryVariant("")
    }, [])

    const routerRevisions = useMemo(() => {
        if (!router.query.revisions) return []

        try {
            if (typeof router.query.revisions === "string") {
                const listOfRevisions = JSON.parse(router.query.revisions)

                if (selectedDrawerVariant && !selectedDrawerVariant._parentVariant) {
                    return [
                        variants?.find((v) => listOfRevisions.includes(v.id))?.revisions?.[0]
                            ?._revisionId,
                    ]
                } else {
                    return listOfRevisions
                }
            }
        } catch (e) {
            console.error("Error parsing revisions from URL", e)
        }

        return []
    }, [router.query.revisions, variants])

    const {
        isFetching: isLoading,
        selected,
        setDisplayedVariants,
        promptIds,
        isDirty,
        selectedVariant,
    } = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const revision = state.variants.find((v) => state.selected?.includes(v._revisionId))

                return {
                    selected: state.selected,
                    selectedVariant: revision,
                    isFetching: state.fetching,
                    isDirty: state.dirtyStates?.[revision?._revisionId as string],
                    promptIds: revision?.prompts?.map((p: any) => p.__id) || [],
                }
            },
            [routerRevisions, props.open, environments, variants],
        ),
    })

    console.log("playground-hook", {
        selected,
        selectedVariant,
        setDisplayedVariants,
        promptIds,
        isDirty,
        isLoading,
        variants,
        routerRevisions,
    })

    // Effect to mount revisions from URL when the component loads
    useEffect(() => {
        if ((isLoading ?? false) || routerRevisions?.length === 0) return

        setDisplayedVariants?.(routerRevisions)
    }, [routerRevisions, isLoading, selected])

    return (
        <>
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
                            selectedVariant={selectedVariant}
                            onClose={onClose}
                            variants={variants || []}
                            isDirty={isDirty}
                            selectedDrawerVariant={selectedDrawerVariant}
                            isLoading={isLoading === undefined || isLoading}
                        />
                    ) : (
                        <DeploymentDrawerTitle
                            selectedVariant={selectedVariant}
                            onClose={onClose}
                            revert={revert}
                            isLoading={isLoading === undefined || isLoading}
                        />
                    )
                }
            >
                <VariantDrawerContent
                    selectedVariant={selectedVariant}
                    promptIds={promptIds}
                    isLoading={isLoading === undefined || isLoading}
                    type={type}
                    variants={variants || []}
                />
            </EnhancedDrawer>
        </>
    )
}

export default VariantDrawer
