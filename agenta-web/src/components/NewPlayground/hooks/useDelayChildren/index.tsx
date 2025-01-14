import {useState, useEffect} from "react"

const useDelayChildren = (delay: number = 100) => {
    const [showNested, setShowNested] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => setShowNested(true), delay) // Defer nested components
        return () => clearTimeout(timer)
    }, [delay])

    return showNested
}

export default useDelayChildren
