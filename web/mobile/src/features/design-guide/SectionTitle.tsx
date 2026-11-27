export function SectionTitle({title, description}: {title: string; description: string}) {
    return (
        <div className="mb-4">
            <h2 className="text-title">{title}</h2>
            <p className="text-body text-muted-foreground">{description}</p>
        </div>
    )
}
