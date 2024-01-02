import {durationToStr} from "@/lib/helpers/utils"
import {useEffect, useState} from "react"

export const useDurationCounter = (duration: number, isRunning: boolean = true) => {
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
