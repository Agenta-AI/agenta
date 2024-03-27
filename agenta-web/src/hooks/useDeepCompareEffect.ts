import {isEqual} from "lodash"
import React, {useEffect, useRef} from "react"
import {useUpdateEffect} from "usehooks-ts"

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
    useUpdateEffect(callback, deps?.map(useDeepCompareMemoize))
}
