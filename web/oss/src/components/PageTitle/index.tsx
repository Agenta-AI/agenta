import {formatPageTitle} from "@agenta/shared/utils"
import Head from "next/head"

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
