import {BareFetcher, Key, SWRConfiguration, SWRResponse} from "swr"
import {initialState} from "../assets/constants"
import {fetchAndUpdateVariants, setVariants} from "../assets/helpers"
import cloneDeep from "lodash/cloneDeep"
import {PlaygroundStateData, UsePlaygroundStateOptions} from "../types"

const openApiJsonMiddleware =
    <D extends PlaygroundStateData = PlaygroundStateData>(
        swrNext: (
            key: string | Key,
            fetcher: BareFetcher<D> | null,
            config: UsePlaygroundStateOptions<D>,
        ) => SWRResponse<D, Error>,
    ) =>
    (_key: string | Key, _fetcher: any, config: UsePlaygroundStateOptions<D>) => {
        const fetcher = async (url: string): Promise<PlaygroundStateData> => {
            const cache = config.cache || new Map()
            if (!_key) return {} as PlaygroundStateData
            const cachedValue = cache.get(_key.toString())
            if (!config.service) return cachedValue

            const state = cloneDeep(cachedValue || initialState) as PlaygroundStateData

            if (!_fetcher) {
                return {} as PlaygroundStateData
            }

            const data = await _fetcher(url)
            state.variants = setVariants(state.variants, data)

            await fetchAndUpdateVariants(state.variants, config.service)

            return state
        }

        const {data, ...rest} = swrNext(_key, fetcher as BareFetcher<D>, config)
        return {
            data: (data as PlaygroundStateData) || initialState,
            ...rest,
        }
    }

export default openApiJsonMiddleware
