import {createContext, useContext} from "react"

import {ROLE_COLOR_CLASSES} from "./constants"

const RoleColorClassesContext = createContext<Record<string, string>>(ROLE_COLOR_CLASSES)

/** Sets the role label colors of the chat cells below it. Without it they use `ROLE_COLOR_CLASSES`. */
export const RoleColorClassesProvider = RoleColorClassesContext.Provider

export const useRoleColorClasses = () => useContext(RoleColorClassesContext)
