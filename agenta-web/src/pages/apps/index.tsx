import {useRouter} from "next/router"
import AppSelector from "@/components/AppSelector/AppSelector"

export default function Apps() {
    const router = useRouter()
    return <AppSelector />
}
