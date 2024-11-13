import ProtectedRoute from "@/components/ProtectedRoute/ProtectedRoute"
import ObservabilityDashboard from "@/components/pages/observability/ObservabilityDashboard"

const GlobalObservability = () => {
    return <ObservabilityDashboard />
}

export default () => (
    <ProtectedRoute>
        <GlobalObservability />
    </ProtectedRoute>
)
