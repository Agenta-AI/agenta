import {useLayoutEffect, useEffect} from "react"

// useIsomorphicLayoutEffect is a custom hook that uses useLayoutEffect on the client-side
// (when window is defined) and useEffect on the server-side (when window is undefined).
// This ensures that the code runs correctly in both client-side and server-side environments.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

export default useIsomorphicLayoutEffect
