interface ComparisonVariantConfigSkeletonProps {
    count?: number
    isComparisonView?: boolean
}

const ComparisonVariantConfigSkeleton = ({
    count = 2,
    isComparisonView = false,
}: ComparisonVariantConfigSkeletonProps) => {
    return Array.from({length: count}).map((_, index) => (
        <div
            key={`variant-config-skeleton-${index}`}
            className={
                isComparisonView
                    ? "[&::-webkit-scrollbar]:w-0 min-w-[400px] flex-1 h-full max-h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] relative"
                    : undefined
            }
        >
            <div className="p-4 space-y-4">
                <div className="h-8 bg-gray-200 rounded" />
                <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded" />
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
                <div className="h-32 bg-gray-200 rounded" />
            </div>
        </div>
    ))
}

export default ComparisonVariantConfigSkeleton
