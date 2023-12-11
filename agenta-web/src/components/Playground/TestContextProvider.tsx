import {GenericObject} from "@/lib/Types"
import React, {PropsWithChildren, createContext, useState} from "react"

export const TestContext = createContext<{
    testList: Record<string, string>[]
    setTestList: React.Dispatch<React.SetStateAction<GenericObject[]>>
}>({testList: [{}], setTestList: () => {}})

const TestContextProvider: React.FC<PropsWithChildren> = (props) => {
    const [testList, setTestList] = useState<GenericObject[]>([{}])

    return (
        <TestContext.Provider value={{testList, setTestList}}>
            {props.children}
        </TestContext.Provider>
    )
}

export default TestContextProvider
