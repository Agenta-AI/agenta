import AppSelector from "@/components/AppSelector/AppSelector"
import {SessionAuth} from "supertokens-auth-react/recipe/session"

export default function Apps() {
    return (
        <SessionAuth>
            <AppSelector />
        </SessionAuth>
    )
}
