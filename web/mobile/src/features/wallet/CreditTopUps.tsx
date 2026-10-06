import {useCallback, useMemo} from "react"

import {
    CreditTopUpsSection,
    readTopUpReturn,
    TOP_UP_QUERY,
    withoutTopUpQuery,
} from "@agenta/settings-ui"
import {useRouter} from "next/router"

/**
 * This app's binding of the shared top-up section, on the Credits tab and on Usage & Billing: the
 * Stripe return and the "open the picker" request come from this page's URL; the host says where
 * the free plan's upgrade goes and whether the section is a card.
 */
export const CreditTopUps = ({
    projectId,
    onUpgrade,
    framed = false,
    showLoadError = false,
}: {
    projectId: string
    onUpgrade: () => void
    framed?: boolean
    /** Only where the wallet is known to be enforced (the Credits tab). */
    showLoadError?: boolean
}) => {
    const router = useRouter()
    // Read once per URL: the section keeps what it needs after the URL is cleared.
    const topUpReturn = useMemo(
        () => readTopUpReturn(router.query),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [router.query[TOP_UP_QUERY.result], router.query[TOP_UP_QUERY.session]],
    )

    const clearQuery = useCallback(() => {
        // The pathname keeps the route's own params (workspace, project) out of the query string.
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
            showLoadError={showLoadError}
        />
    )
}
