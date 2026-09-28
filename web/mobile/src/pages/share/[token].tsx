import {useRouter} from "next/router"

import {SharedAppScreen} from "@/features/share/SharedAppScreen"

// Thin shell: a shared app's link. Opens without sign-in for a `link` share.
export default function SharedApp() {
    const router = useRouter()
    const token = typeof router.query.token === "string" ? router.query.token : ""
    const v = typeof router.query.v === "string" ? Number.parseInt(router.query.v, 10) : NaN
    if (!router.isReady) return null
    return <SharedAppScreen token={token} version={Number.isFinite(v) && v > 0 ? v : null} />
}
