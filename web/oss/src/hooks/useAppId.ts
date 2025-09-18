import {useRouter} from "next/router"

export const useAppId = (): string => {
    const router = useRouter()
    const appId = (router.query.app_id ?? "") as string

    return appId
}
