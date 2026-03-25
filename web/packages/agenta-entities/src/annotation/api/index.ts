/**
 * Annotation API Module
 *
 * Exports pure HTTP functions for annotation CRUD + batch query.
 */

export {
    createAnnotation,
    fetchAnnotation,
    updateAnnotation,
    deleteAnnotation,
    queryAnnotations,
    queryAnnotationsByInvocationLink,
} from "./api"
