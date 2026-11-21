import {NotFoundScreen} from "@agenta/auth-ui"
import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"

/** The app's "not found" page: the 404 route, and any page that refuses to show itself. */
export const PageNotFound = () => {
    const t = useT(navigationCatalog)
    const router = useRouter()

    return (
        <>
            <PageTitle title={t("navigation.chrome.pageNotFound")} />
            <NotFoundScreen
                onBack={() => router.back()}
                path={router.asPath === "/404" ? undefined : router.asPath}
            />
        </>
    )
}
