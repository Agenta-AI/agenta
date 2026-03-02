import type {FC, ReactNode} from "react"

const NoSSRWrapper: FC<{children: ReactNode}> = ({children}) => <>{children}</>

export default NoSSRWrapper
