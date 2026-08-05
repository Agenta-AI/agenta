import {useEffect, useState} from "react"

import {durationToStr} from "@/oss/lib/helpers/utils"

export const useDurationCounter = (duration: number, isRunning = true) => {
    const [elapsed, setElapsed] = useState(duration)

    useEffect(() => {
        if (isRunning) {
            const interval = setInterval(() => {
                setElapsed((prev) => prev + 1000)
            }, 1000)
            return () => clearInterval(interval)
        }
    }, [isRunning])

    return durationToStr(elapsed)
}
