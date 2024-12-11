import AppManagement from "@/components/pages/app-management"
import ProtectedRoute from "@/components/ProtectedRoute/ProtectedRoute"

export default function Apps() {
    return (
        <ProtectedRoute>
            <AppManagement />
        </ProtectedRoute>
    )
}
