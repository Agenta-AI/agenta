import Head from "next/head"

import {formatPageTitle} from "./utils"

interface PageTitleProps {
    title?: string | null
    context?: string | null
}

const PageTitle = ({title, context}: PageTitleProps) => (
    <Head>
        <title>{formatPageTitle(title, context)}</title>
    </Head>
)

export default PageTitle
