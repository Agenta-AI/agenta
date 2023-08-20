import {useRouter} from "next/router"
import AppSelector from "@/components/AppSelector/AppSelector"
import {SessionAuth} from "supertokens-auth-react/recipe/session"

export default function Apps() {
    const router = useRouter()
    return (
        <SessionAuth
            onSessionExpired={() => {
                router.push("/auth")
            }}
        >
            <AppSelector />
        </SessionAuth>
    )
}
