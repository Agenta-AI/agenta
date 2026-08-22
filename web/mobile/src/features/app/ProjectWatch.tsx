import {useProjectWatch} from "./useProjectWatch"

/** Null-rendering: holds the project-wide watch open for as long as the app is mounted. */
export const ProjectWatch = () => {
    useProjectWatch()
    return null
}
