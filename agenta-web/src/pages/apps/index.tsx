import AppSelector from "@/components/AppSelector/AppSelector"
import ProtectedRoute from "@/components/ProtectedRoute/ProtectedRoute"

export default function Apps() {
    return (
        <ProtectedRoute>
            <AppSelector />
        </ProtectedRoute>
    )
}
