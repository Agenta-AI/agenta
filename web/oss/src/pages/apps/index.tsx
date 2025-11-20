import AppManagement from "@/oss/components/pages/app-management"
import ProtectedRoute from "@/oss/components/ProtectedRoute/ProtectedRoute"

export default function Apps() {
    return (
        <ProtectedRoute>
            <AppManagement />
        </ProtectedRoute>
    )
}
