import {GenericObject} from "@/lib/Types"
import React, {PropsWithChildren, createContext, useState} from "react"

export const TestContext = createContext<{
    testList: GenericObject[]
    setTestList: React.Dispatch<React.SetStateAction<GenericObject[]>>
    isRunning: boolean[]
    setIsRunning: React.Dispatch<React.SetStateAction<boolean[]>>
}>({testList: [{}], setTestList: () => {}, isRunning: [], setIsRunning: () => {}})

const TestContextProvider: React.FC<PropsWithChildren> = (props) => {
    const [testList, setTestList] = useState<GenericObject[]>([{}])
    const [isRunning, setIsRunning] = useState<boolean[]>([])

    return (
        <TestContext.Provider value={{testList, setTestList, isRunning, setIsRunning}}>
            {props.children}
        </TestContext.Provider>
    )
}

export default TestContextProvider
