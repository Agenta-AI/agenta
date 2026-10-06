import {useCallback, useMemo} from "react"

import {
    CreditTopUpsSection,
    readTopUpReturn,
    TOP_UP_QUERY,
    withoutTopUpQuery,
} from "@agenta/settings-ui"
import {useRouter} from "next/router"

/**
 * The Credits tab's binding of the shared top-up section: the Stripe return and the "open the
 * picker" request come from this page's URL, and the free plan's upgrade goes to Usage & Billing.
 */
export const CreditTopUps = ({projectId, billingURL}: {projectId: string; billingURL: string}) => {
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
            onUpgrade={() => void router.push(billingURL)}
        />
    )
}
