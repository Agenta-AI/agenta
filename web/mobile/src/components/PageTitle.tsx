import Head from "next/head"

/**
 * The tab name, in one place.
 *
 * Most specific part first: a phone's tab strip and the app switcher both show only the leading
 * characters, so "approval-flow-test" has to win over the product name. Empty parts drop out, so
 * a screen can pass a name that has not resolved yet without rendering "undefined".
 */
export const PageTitle = ({parts}: {parts: (string | null | undefined)[]}) => (
    <Head>
        <title>{[...parts.filter(Boolean), "Agenta"].join(" · ")}</title>
    </Head>
)
