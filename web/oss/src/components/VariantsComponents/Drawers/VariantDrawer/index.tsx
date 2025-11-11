import {useCallback, useEffect, useMemo, useState} from "react"

import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/components/Playground/hooks/usePlayground/types"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"

import type {VariantDrawerProps, ViewType} from "./assets/types"
import {findVariantById} from "./utils"

const VariantDrawerContent = dynamic(() => import("./assets/VariantDrawerContent"), {ssr: false})
const VariantDrawerTitle = dynamic(() => import("./assets/VariantDrawerTitle"), {ssr: false})
const DeploymentDrawerTitle = dynamic(() => import("./assets/DeploymentDrawerTitle"), {ssr: false})

const VariantDrawer = ({variants, type, revert, ...props}: VariantDrawerProps) => {
    const appId = useAppId()
    const [queryVariant, setQueryVariant] = useQueryParam("revisions")
    const router = useRouter()
    const {environments} = useEnvironments({appId})

    const [viewAs, setViewAs] = useState<ViewType>("prompt")

    const selectedDrawerVariant = useMemo(() => {
        if (!queryVariant) return undefined

        const targetId = JSON.parse(queryVariant)[0] as string
        return findVariantById(variants ?? [], targetId)
    }, [queryVariant, variants])

    const onClose = useCallback(() => {
        props.onClose?.({} as any)
        setQueryVariant("")
        setViewAs("prompt")
    }, [])

    const onChangeViewAs = useCallback((view: ViewType) => {
        setViewAs(view)
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

    // Effect to mount revisions from URL when the component loads
    useEffect(() => {
        if ((isLoading ?? false) || routerRevisions?.length === 0) return

        setDisplayedVariants?.(routerRevisions)
    }, [routerRevisions, isLoading, selected])

    // Effect to close drawer when outside click
    useEffect(() => {
        if (!queryVariant) return

        function handleClickOutside(event: MouseEvent) {
            // Check if the click is inside the table row
            if ((event.target as HTMLElement).closest(".variant-table-row")) {
                return
            } else if ((event.target as HTMLElement).closest(".ant-layout")) {
                // Close drawer if outside click
                setQueryVariant("")
            }
        }

        document.addEventListener("click", handleClickOutside)
        return () => {
            document.removeEventListener("click", handleClickOutside)
        }
    }, [queryVariant])

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
                            viewAs={viewAs}
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
                    onChangeViewAs={onChangeViewAs}
                />
            </EnhancedDrawer>
        </>
    )
}

export default VariantDrawer
