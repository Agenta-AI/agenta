import useStateCallback, {DispatchWithCallback} from "@/hooks/useStateCallback"
import {GenericObject} from "@/lib/Types"
import {randString} from "@/lib/helpers/utils"
import React, {PropsWithChildren, SetStateAction, createContext, useState} from "react"

export const TestContext = createContext<{
    testList: GenericObject[]
    setTestList: React.Dispatch<React.SetStateAction<GenericObject[]>>
    isRunning: boolean[]
    setIsRunning: DispatchWithCallback<SetStateAction<boolean[]>>
}>({testList: [{}], setTestList: () => {}, isRunning: [], setIsRunning: () => {}})

const TestContextProvider: React.FC<PropsWithChildren> = (props) => {
    const [testList, setTestList] = useState<GenericObject[]>([{_id: randString(6)}])
    const [isRunning, setIsRunning] = useStateCallback<boolean[]>([])

    return (
        <TestContext.Provider value={{testList, setTestList, isRunning, setIsRunning}}>
            {props.children}
        </TestContext.Provider>
    )
}

export default TestContextProvider
