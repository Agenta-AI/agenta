import AppSelector from "@/components/AppSelector/AppSelector"
import ProtectedRoute from "@/components/ProtectedRoute/ProtectedRoute"

const isDemo = process.env.NEXT_PUBLIC_DEMO === "true"

export default function Apps() {
    return isDemo ? (
        <ProtectedRoute>
            <AppSelector />
        </ProtectedRoute>
    ) : (
        <AppSelector />
    )
}
