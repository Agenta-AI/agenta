import {useEffect, useRef} from "react"

import isEqual from "lodash/isEqual"

import useLazyEffect from "@/oss/hooks/useLazyEffect"

function useDeepCompareMemoize(value: any) {
    const ref = useRef()

    if (!isEqual(value, ref.current)) {
        ref.current = value
    }

    return ref.current
}

export function useDeepCompareEffect(callback: React.EffectCallback, deps?: React.DependencyList) {
    useEffect(callback, deps?.map(useDeepCompareMemoize))
}

export function useDeepCompareUpdateEffect(
    callback: React.EffectCallback,
    deps?: React.DependencyList,
) {
    useLazyEffect(callback, deps?.map(useDeepCompareMemoize))
}
