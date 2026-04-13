/** Minimal variant shape needed by VariantDetailsWithStatus and its sub-components */
export interface VariantStatusInfo {
    id: string
    deployedIn?: {name: string}[]
    isLatestRevision?: boolean
}
