import {GenericObject} from "@/lib/Types"
import React, {Dispatch, PropsWithChildren, SetStateAction, createContext, useState} from "react"

export const TestContext = createContext<{
    testList: GenericObject[]
    setTestList: Dispatch<SetStateAction<GenericObject[]>>
}>({testList: [{}], setTestList: () => {}})

const TestsetContextProvider: React.FC<PropsWithChildren> = (props) => {
    const [testList, setTestList] = useState<GenericObject[]>([{}])

    return (
        <TestContext.Provider value={{testList, setTestList}}>
            {props.children}
        </TestContext.Provider>
    )
}

export default TestsetContextProvider
