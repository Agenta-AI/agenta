export interface AnnotateCollapseContentProps {
    metadata: any
    annSlug: string
    disabled?: boolean
    onChange: (annSlug: string, metricKey: string, newValue: any) => void
}
