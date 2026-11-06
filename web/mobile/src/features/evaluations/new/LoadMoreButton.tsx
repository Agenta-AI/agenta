import {Button, Spinner} from "@agenta/ui/ui"

/** "Load more" under a step table, while the server has more rows. */
export const LoadMoreButton = ({
    loading,
    onLoadMore,
}: {
    loading: boolean
    onLoadMore: () => void
}) => (
    <div className="flex justify-center py-2">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading ? <Spinner aria-label="Loading more" /> : null}
            Load more
        </Button>
    </div>
)
