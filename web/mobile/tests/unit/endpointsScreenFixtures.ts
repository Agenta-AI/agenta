import {atom} from "jotai"

/** What the Endpoints screen reads, as atoms a test can set. */
export interface FakeEnv {
    slug: string
    name: string
    deployedVariantId: string | null
    deployedRevisionId: string | null
    deployedVariantName: string | null
    revision: string | null
    updatedAt: string | null
}

export const appsAtom = atom<{
    data: {id: string; name: string; slug: string}[]
    isPending: boolean
    isError: boolean
}>({data: [], isPending: false, isError: false})

export const variantsAtom = atom<{data: unknown[]; isPending: boolean; isError: boolean}>({
    data: [],
    isPending: false,
    isError: false,
})

export const envsQuery = atom<{
    data: FakeEnv[]
    isPending: boolean
    isError: boolean
    refetch: () => void
}>({data: [], isPending: false, isError: false, refetch: () => undefined})

export const revisionAtom = atom<{
    url: string | null
    inputSchema: Record<string, unknown> | null
    isChat: boolean
}>({url: "https://api.test/services/completion/invoke", inputSchema: null, isChat: false})

export const fakeEnv = (name: string, slug = name, deployed = true): FakeEnv => ({
    name,
    slug,
    deployedVariantId: deployed ? `${slug}-variant` : null,
    deployedRevisionId: deployed ? `${slug}-revision` : null,
    deployedVariantName: null,
    revision: null,
    updatedAt: null,
})

export const revisionQuery = atom<{isPending: boolean; isError: boolean}>({
    isPending: false,
    isError: false,
})
