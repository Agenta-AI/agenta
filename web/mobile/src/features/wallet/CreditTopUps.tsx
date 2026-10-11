import {useCallback, useMemo} from "react"

import {
    CreditTopUpsSection,
    readTopUpReturn,
    TOP_UP_QUERY,
    withoutTopUpQuery,
} from "@agenta/settings-ui"
import {useRouter} from "next/router"

/** The shared top-up section on Plan & billing, fed the Stripe return and picker request from the URL. */
export const CreditTopUps = ({
    projectId,
    onUpgrade,
    framed = false,
}: {
    projectId: string
    onUpgrade: () => void
    framed?: boolean
}) => {
    const router = useRouter()
    // Read once per URL: the section keeps what it needs after the URL is cleared.
    const topUpReturn = useMemo(
        () => readTopUpReturn(router.query),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [router.query[TOP_UP_QUERY.result], router.query[TOP_UP_QUERY.session]],
    )

    const clearQuery = useCallback(() => {
        void router.replace(
            {pathname: router.pathname, query: withoutTopUpQuery(router.query)},
            undefined,
            {shallow: true},
        )
    }, [router])

    return (
        <CreditTopUpsSection
            projectId={projectId}
            topUpReturn={topUpReturn}
            openPicker={router.query[TOP_UP_QUERY.open] === "1"}
            onQueryHandled={clearQuery}
            onUpgrade={onUpgrade}
            framed={framed}
        />
    )
}
