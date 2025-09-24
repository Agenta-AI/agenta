import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useSetAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {OrgDetails} from "@/oss/lib/Types"
import {projectIdAtom} from "@/oss/state/project"

import {
    orgsQueryAtom,
    selectedOrgQueryAtom,
    selectedOrgIdAtom,
    orgsAtom,
    selectedOrgAtom,
} from "./selectors/org"

const EmptyOrgs: OrgDetails[] = []

export const useOrgData = () => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const [{data: orgs, isPending: loadingOrgs, refetch: refetchOrgs}] = useAtom(orgsQueryAtom)
    const [{data: selectedOrg, isPending: loadingDetails, refetch: refetchSelectedOrg}] =
        useAtom(selectedOrgQueryAtom)
    const setSelectedOrgId = useSetAtom(selectedOrgIdAtom)
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)
    const setProjectId = useSetAtom(projectIdAtom)

    const changeSelectedOrg = useCallback(
        (orgId: string, onSuccess?: () => void) => {
            if (loadingOrgs) return
            queryClient.removeQueries({queryKey: ["selectedOrg", selectedOrgId]})
            setSelectedOrgId(orgId)
            setProjectId(null)
        },
        [setSelectedOrgId, selectedOrgId, loadingOrgs, queryClient, router, setProjectId],
    )

    const setSelectedOrg = useCallback(
        (value: React.SetStateAction<OrgDetails | null>) => {
            queryClient.setQueryData(["selectedOrg", selectedOrgId], (prev: OrgDetails | null) =>
                typeof value === "function" ? (value as any)(prev) : value,
            )
        },
        [queryClient, selectedOrgId],
    )

    const reset = useCallback(async () => {
        await queryClient.removeQueries({queryKey: ["orgs"]})
        await queryClient.removeQueries({queryKey: ["selectedOrg"]})
        setSelectedOrgId(null)
    }, [queryClient, setSelectedOrgId])

    const refetch = useCallback(async () => {
        await refetchOrgs()
        await refetchSelectedOrg()
    }, [refetchOrgs, refetchSelectedOrg])

    return {
        orgs: orgs ?? EmptyOrgs,
        selectedOrg: selectedOrg ?? null,
        loading: loadingOrgs || loadingDetails,
        changeSelectedOrg,
        setSelectedOrg,
        reset,
        refetch,
    }
}

export const useSelectedOrg = () => useAtomValue(selectedOrgAtom)
export const useOrgList = () => useAtomValue(orgsAtom)
