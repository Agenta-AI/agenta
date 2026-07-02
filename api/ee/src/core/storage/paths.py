from uuid import UUID


def org_prefix(org_id: UUID) -> str:
    """S3/SeaweedFS prefix for an entire org. Trailing slash included."""
    return f"{org_id}/"


def project_prefix(org_id: UUID, project_id: UUID) -> str:
    """S3/SeaweedFS prefix for one project within an org."""
    return f"{org_id}/{project_id}/"
