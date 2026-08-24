class MigrationError(Exception):
    """A schema migration failed before the original database was replaced, or a
    durability step failed after it was replaced (e.g. fsync of the new file or its
    parent directory); in either case no usable schema is guaranteed."""
