"""Alias of `ee.databases.postgres.migrations.runner`.

Old compose, Helm and Railway files start the migrations with
`python -m oss.databases.postgres.migrations.runner`. Every install now runs the
same chains, so this module only calls the ee runner. Remove it when those files
no longer name it.
"""

from ee.databases.postgres.migrations.runner import main


if __name__ == "__main__":
    main()
