import {useRouter} from "next/router"

export const useAppId = (): string => {
    const router = useRouter()
    return (router.query.app_id ?? "") as string
}
