import {NextRouter, useRouter} from "next/router"
import {ParsedUrlQuery, parse} from "querystring"

type Method = "push" | "replace"

function getUpdateQuery(router: NextRouter, method: Method) {
    return (queryObj: ParsedUrlQuery) => {
        const query = parse(window.location.search.replace("?", ""))

        //do not update query if the value is the same
        let changed = false
        for (const key in queryObj) {
            if (query[key]?.toString() !== queryObj[key]?.toString()) {
                changed = true
                break
            }
        }
        if (!changed) return

        const newQuery = {
            ...query,
            ...queryObj,
        }
        //delete keys with undefined values
        Object.keys(newQuery).forEach((key) => {
            if (newQuery[key] === undefined || newQuery[key] === "") {
                delete newQuery[key]
            }
        })

        router[method]({
            pathname: window.location.pathname,
            query: newQuery,
        })
    }
}

export function useQuery(
    method: Method = "push",
): [ParsedUrlQuery, (query: ParsedUrlQuery) => void] {
    const router = useRouter()
    const {query} = router

    return [query, getUpdateQuery(router, method)]
}

export function useQueryParam(
    paramName: string,
    defaultValue?: string,
    method?: Method,
): [string, (val: string) => void] {
    const [query, updateQuery] = useQuery(method)
    const value = (query as Record<string, any>)[paramName] || defaultValue

    const setValue = (val: string) => {
        updateQuery({[paramName]: val})
    }

    return [value, setValue]
}
