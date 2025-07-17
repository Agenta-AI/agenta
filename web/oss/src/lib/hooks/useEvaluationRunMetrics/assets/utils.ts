import axios from "../../../api/assets/axiosConfig"
import type {MetricResponse} from "../types"

/**
 * SWR fetcher for fetching metrics from the API.
 *
 * Given a URL, this function performs a GET request to the URL, extracts the
 * `metrics` array, `count`, and `next` properties from the response, and
 * returns them in an object.
 *
 * @param {string} url The URL to fetch
 * @return {Promise<{metrics: MetricResponse[], count: number, next?: string}>}
 */
export const fetcher = (url: string) =>
    axios.get(url).then((res) => {
        const raw = res.data
        const metrics: MetricResponse[] = Array.isArray(raw.metrics) ? raw.metrics : []
        return {
            metrics,
            count: raw.count as number,
            next: raw.next as string | undefined,
        }
    })
