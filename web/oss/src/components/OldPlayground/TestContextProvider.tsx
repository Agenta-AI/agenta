import {PropsWithChildren, SetStateAction, createContext, useState} from "react"

import useStateCallback, {DispatchWithCallback} from "@/oss/hooks/useStateCallback"
import {randString} from "@/oss/lib/helpers/utils"
import {GenericObject} from "@/oss/lib/Types"

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
