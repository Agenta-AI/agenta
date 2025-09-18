/**
 * Variant options atoms (grouped tree for SelectVariant)
 * Scope: grouped options with deployments and revisions.
 */
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import groupBy from "lodash/groupBy"
import uniqBy from "lodash/uniqBy"

import {revisionDeploymentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

import {revisionListAtom} from "./variants"

/**
 * OPTIMIZED VARIANT OPTIONS SELECTOR ATOM FAMILY
 * Creates selector atoms for variant options with deep equality checks
 * Eliminates the need for useMemo in React components
 */
export const variantOptionsAtomFamily = atomFamily((searchTerm = "") =>
    selectAtom(
        atom((get) => {
            const allRevisions = get(revisionListAtom) || []

            // Filter to only revisions with revision number > 0
            const validRevisions = allRevisions.filter((v: any) => Number(v.revision) > 0)

            // Group revisions by variant ID
            const revisionParents = groupBy(validRevisions, "variantId")

            // Build options with deployedIn derived from revisionDeploymentAtomFamily
            const options = Object.values(revisionParents).map((variantRevisions: any[]) => {
                const deployments = variantRevisions.flatMap((rev: any) => {
                    const envs = get(revisionDeploymentAtomFamily(rev.id)) || []
                    return envs
                })
                const deployedIn = uniqBy(deployments, (env: any) => env.name)

                return {
                    // Note: title will need to be created in the component since it contains JSX
                    selectable: false,
                    id: variantRevisions[0].variantId,
                    label: variantRevisions[0].variantName || "",
                    value: variantRevisions[0].variantId,
                    variantName: variantRevisions[0].variantName,
                    deployedIn,
                    children: variantRevisions
                        .sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)
                        .map((revision) => {
                            return {
                                id: revision.id,
                                // Note: title will need to be created in the component since it contains JSX
                                label: revision.variantName,
                                revisionNumber: revision.revisionNumber,
                                value: revision.id,
                                selectable: true,
                                revision: revision.revision,
                                variantName: revision.variantName,
                                variant: revision,
                            }
                        }),
                }
            })

            return options
        }),
        (options) => {
            if (!options) return []

            if (searchTerm) {
                const lower = searchTerm.toLowerCase()
                return (options as any[])
                    .map((opt: any) => {
                        const parentMatches = opt.label.toLowerCase().includes(lower)
                        const children = parentMatches
                            ? opt.children
                            : (opt.children as any[]).filter((child: any) =>
                                  child.revisionNumber.toString().includes(lower),
                              )
                        return {...opt, children}
                    })
                    .filter(
                        (opt: any) =>
                            opt.label.toLowerCase().includes(lower) || opt.children.length > 0,
                    )
            }

            return options as any[]
        },
        isEqual, // Deep equality check to prevent unnecessary re-renders
    ),
)
