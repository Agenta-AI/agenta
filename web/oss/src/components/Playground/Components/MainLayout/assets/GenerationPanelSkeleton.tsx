const GenerationPanelSkeleton = () => {
    return (
        <div className="p-4 space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/4" />
            <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded w-5/6" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
            </div>
            <div className="h-24 bg-gray-200 rounded" />
            <div className="flex gap-2">
                <div className="h-8 w-16 bg-gray-200 rounded" />
                <div className="h-8 w-20 bg-gray-200 rounded" />
            </div>
        </div>
    )
}

export default GenerationPanelSkeleton
