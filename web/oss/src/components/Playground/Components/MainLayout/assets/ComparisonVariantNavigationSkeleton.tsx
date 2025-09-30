const ComparisonVariantNavigationSkeleton = () => {
    return (
        <div className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white">
            <div className="p-4 space-y-4">
                <div className="h-6 bg-gray-200 rounded mb-4" />
                {[1, 2, 3].map((index) => (
                    <div
                        key={`nav-skeleton-${index}`}
                        className="space-y-3 p-3 border border-gray-100 rounded"
                    >
                        <div className="h-5 bg-gray-200 rounded" />
                        <div className="h-4 bg-gray-200 rounded w-3/4" />
                        <div className="h-3 bg-gray-200 rounded w-1/2" />
                    </div>
                ))}
            </div>
        </div>
    )
}

export default ComparisonVariantNavigationSkeleton
