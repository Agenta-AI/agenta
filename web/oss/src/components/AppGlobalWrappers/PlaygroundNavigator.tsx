import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {
    navigationSelectionScopeAtom,
    playgroundNavigationRequestAtom,
} from "@/oss/state/variant/atoms/navigation"
import {selectedVariantsAtom} from "@/oss/state/variant/atoms/selection"

const PlaygroundNavigator = () => {
    const router = useRouter()
    const [request, setRequest] = useAtom(playgroundNavigationRequestAtom)
    const navScope = useAtomValue(navigationSelectionScopeAtom)
    const scopedAtom = useMemo(
        () => (navScope ? selectedVariantsAtom(navScope) : atom<any[]>([])),
        [navScope],
    )
    const scopedSelected = useAtomValue(scopedAtom)

    useEffect(() => {
        if (!request) return

        const {appId, selectedKeys} = request
        const scopeRevisions = navScope ? scopedSelected.map((v) => v._revisionId ?? v.id) : []
        const revisions = selectedKeys && selectedKeys.length > 0 ? selectedKeys : scopeRevisions

        const param = buildRevisionsQueryParam(revisions as any)
        const params = param ? {revisions: param} : {}

        router.push({
            pathname: `/apps/${appId}/playground`,
            query: params,
        })

        // reset request after handling to avoid repeated navigations
        setRequest(null)
    }, [request, router, setRequest])

    return null
}

export default PlaygroundNavigator
