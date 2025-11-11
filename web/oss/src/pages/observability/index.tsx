import ObservabilityDashboard from "@/oss/components/pages/observability/ObservabilityDashboard"
import ProtectedRoute from "@/oss/components/ProtectedRoute/ProtectedRoute"

const GlobalObservability = () => {
    return <ObservabilityDashboard />
}

export default () => (
    <ProtectedRoute>
        <GlobalObservability />
    </ProtectedRoute>
)
