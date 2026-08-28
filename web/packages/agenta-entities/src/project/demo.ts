/**
 * Drop demo projects from a project list, falling back to the full list when every project is a
 * demo one — hiding them there would leave an empty, dead-end UI.
 *
 * Shared because BOTH shells have to agree: the desktop hides demo projects (`projectsAtom`) while
 * `/m` used to show them, so a mobile sign-in could resolve into a demo org the desktop never
 * offers. Generic over the row so `/m`'s zod-inferred project type keeps its own shape.
 */
export const filterOutDemoProjects = <T extends {is_demo?: boolean | null}>(projects: T[]): T[] => {
    const nonDemoProjects = projects.filter((project) => !project.is_demo)
    return nonDemoProjects.length ? nonDemoProjects : projects
}
