#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Flag destructive and write-blocking operations in Alembic revisions.

Deploys run `alembic upgrade head` in a Helm pre-upgrade hook, before any new pod
starts, and the api runs two replicas with `maxUnavailable=0`. During every rollout
the OLD code therefore runs against the NEW schema. A failed deploy rolls the
application back. It never rolls the database back. A dropped column, a renamed
table, a narrowed type, or a tightened NOT NULL breaks the old code that is still
serving traffic, and the break is not reversible by a rollback.

This script does not forbid such a change. It makes the change visible, so that a
reviewer decides it on purpose. The CI job turns a CRITICAL finding into a failed
check until a reviewer applies the `migration:destructive-approved` label.

Only the upgrade path is scanned. `downgrade()` is ignored on purpose: the hook
never runs it, and almost every additive revision drops in `downgrade()` the table
it created in `upgrade()`.

Usage:

    python3 api/scripts/migration_gate.py <revision.py> [<revision.py> ...]
    python3 api/scripts/migration_gate.py --all
    python3 api/scripts/migration_gate.py --all --format json
    python3 api/scripts/migration_gate.py <files> --approved
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence


CRITICAL = "CRITICAL"
WARNING = "WARNING"

APPROVAL_LABEL = "migration:destructive-approved"

# Alembic's own operation handle, plus the alias bound by `with
# op.batch_alter_table(...) as batch_op:`. Both carry the same operations.
OPERATION_ROOTS = {"op"}

# A raw-SQL hatch is reachable through any of these in this tree: `op.execute(...)`,
# `op.get_bind().execute(...)`, `conn.execute(...)`, `session.execute(...)`.
EXECUTE_METHOD = "execute"

VERSIONS_GLOB = "*/databases/postgres/migrations/*/versions/*.py"

ENTRYPOINT = "upgrade"


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    level: str
    operation: str
    reason: str

    def as_text(self) -> str:
        return f"{self.path}:{self.line}  {self.level}  {self.operation}  {self.reason}"

    def as_github(self) -> str:
        kind = "error" if self.level == CRITICAL else "warning"
        title = f"Migration gate: {self.operation}"
        return (
            f"::{kind} file={self.path},line={self.line},title={title}::{self.reason}"
        )

    def as_dict(self) -> dict:
        return {
            "path": self.path,
            "line": self.line,
            "level": self.level,
            "operation": self.operation,
            "reason": self.reason,
        }


# --------------------------------------------------------------------------- SQL


def _collapse(sql: str) -> str:
    """Strip SQL comments, collapse whitespace, and uppercase for matching."""
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"\s+", " ", sql).strip().upper()


# `DROP <word>` inside an ALTER TABLE. Only some of those words are destructive.
_ALTER_DROP_HARMLESS = {"DEFAULT", "NOT"}  # DROP DEFAULT, DROP NOT NULL: both relax.
_ALTER_DROP_WARNING = {"CONSTRAINT"}

# `RENAME <word>` inside an ALTER TABLE. Renaming a constraint only breaks code
# that names it, for example an `ON CONFLICT ON CONSTRAINT` upsert. Renaming a
# column, or the table itself, breaks every query against the old name.
_ALTER_RENAME_WARNING = {"CONSTRAINT"}

_SQL_CRITICAL = (
    (r"\bDROP\s+TABLE\b", "DROP TABLE", "drops a table the running code still reads"),
    (
        r"\bDROP\s+(?:SCHEMA|DATABASE)\b",
        "DROP SCHEMA",
        "drops a schema the running code still reads",
    ),
    (
        r"\bDROP\s+TYPE\b",
        "DROP TYPE",
        "drops an enum type the running code still writes",
    ),
    (r"\bTRUNCATE\b", "TRUNCATE", "deletes every row, and no rollback restores them"),
    (
        r"\bALTER\s+TABLE\b.*\bALTER\b.*\bTYPE\b",
        "ALTER TABLE ALTER TYPE",
        "rewrites a column type under the running code, and holds an ACCESS EXCLUSIVE lock",
    ),
    (
        r"\bALTER\s+TABLE\b.*\bSET\s+NOT\s+NULL\b",
        "ALTER TABLE SET NOT NULL",
        "rejects every insert from running code that does not yet send the column",
    ),
    (
        r"\bALTER\s+TYPE\b.*\bRENAME\b",
        "ALTER TYPE RENAME",
        "renames a type the running code still refers to",
    ),
)

_SQL_WARNING = (
    (
        r"\bDROP\s+INDEX\b",
        "DROP INDEX",
        "a query that depended on this index gets slow",
    ),
    (
        r"\bREINDEX\b",
        "REINDEX",
        "blocks writes on the table for the whole rebuild",
    ),
)


_SQL_TABLE = re.compile(
    r"\b(?:ALTER|DROP|TRUNCATE|CREATE)\s+(?:TABLE\s+)?(?:IF\s+EXISTS\s+)?"
    r"(?:ONLY\s+)?\"?([A-Z0-9_.]+)\"?"
)


def _sql_table(statement: str) -> str | None:
    match = _SQL_TABLE.search(statement)
    return match.group(1).lower() if match else None


def _sql_created_tables(sql: str) -> set[str]:
    """Table names a raw-SQL literal creates."""
    created = set()
    for statement in _collapse(sql).split(";"):
        match = re.search(
            r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?([A-Z0-9_.]+)\"?",
            statement,
        )
        if match:
            created.add(match.group(1).lower())
    return created


def _sql_findings(sql: str) -> Iterator[tuple[str, str, str, str | None]]:
    """Yield (level, operation, reason, table) for each statement in a SQL literal."""
    for statement in _collapse(sql).split(";"):
        statement = statement.strip()
        if not statement:
            continue
        table = _sql_table(statement)
        for pattern, operation, reason in _SQL_CRITICAL:
            if re.search(pattern, statement, flags=re.DOTALL):
                yield CRITICAL, operation, reason, table
        if re.search(r"\bALTER\s+TABLE\b", statement):
            for word in re.findall(r"\bDROP\s+(\w+)", statement):
                if word in _ALTER_DROP_HARMLESS:
                    continue
                if word in _ALTER_DROP_WARNING:
                    yield (
                        WARNING,
                        "ALTER TABLE DROP CONSTRAINT",
                        "running code may rely on this constraint, for example in an upsert",
                        table,
                    )
                    continue
                yield (
                    CRITICAL,
                    "ALTER TABLE DROP COLUMN",
                    "drops a column the running code still reads and writes",
                    table,
                )
        if re.search(r"\bALTER\s+TABLE\b", statement):
            for word in re.findall(r"\bRENAME\s+(\w+)", statement):
                if word in _ALTER_RENAME_WARNING:
                    yield (
                        WARNING,
                        "ALTER TABLE RENAME CONSTRAINT",
                        "running code that names this constraint, for example in an "
                        "upsert, no longer finds it",
                        table,
                    )
                    continue
                yield (
                    CRITICAL,
                    "ALTER TABLE RENAME",
                    "renames a table or a column, so the running code queries a name "
                    "that is gone",
                    table,
                )
        if re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", statement) and not re.search(
            r"\bCONCURRENTLY\b", statement
        ):
            yield (
                WARNING,
                "CREATE INDEX",
                "a non-concurrent index build blocks writes on the table",
                table,
            )
        for pattern, operation, reason in _SQL_WARNING:
            if re.search(pattern, statement, flags=re.DOTALL):
                yield WARNING, operation, reason, table


# ------------------------------------------------------------------ AST helpers


def _literal_sql(node: ast.AST) -> str | None:
    """Recover a SQL string from a literal, an f-string, or a `sa.text(...)` wrapper.

    An interpolated value becomes a placeholder, so that a pattern still matches
    across it. Most destructive SQL in this tree is written as an f-string over a
    table or column name held in a module constant.
    """
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if isinstance(node, ast.JoinedStr):
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            else:
                parts.append(" {} ")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Mod)):
        left = _literal_sql(node.left)
        right = _literal_sql(node.right) if isinstance(node.op, ast.Add) else ""
        if left is None:
            return None
        return left + (right or " {} ")
    if isinstance(node, ast.Call):
        # sa.text("..."), text("..."), sqlalchemy.text("...")
        name = (
            node.func.attr
            if isinstance(node.func, ast.Attribute)
            else (node.func.id if isinstance(node.func, ast.Name) else "")
        )
        if name == "text" and node.args:
            return _literal_sql(node.args[0])
    return None


def _keyword(call: ast.Call, name: str) -> ast.AST | None:
    for keyword in call.keywords:
        if keyword.arg == name:
            return keyword.value
    return None


def _is_false(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and node.value is False


def _is_true(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and node.value is True


def _call_target(call: ast.Call, roots: set[str]) -> str | None:
    """Return the operation name when the call is an operation on an Alembic handle."""
    if not isinstance(call.func, ast.Attribute):
        return None
    method = call.func.attr
    value = call.func.value
    if isinstance(value, ast.Name) and value.id in roots:
        return method
    # Any `<something>.execute(...)` is a raw-SQL hatch: op.get_bind().execute(...),
    # conn.execute(...), session.execute(...). All three appear in this tree.
    if method == EXECUTE_METHOD:
        return method
    return None


# ----------------------------------------------------------------- op-level rules


def _add_column_findings(call: ast.Call) -> Iterator[tuple[str, str, str]]:
    nullable = _keyword(call, "nullable")
    column = next(
        (
            argument
            for argument in call.args
            if isinstance(argument, ast.Call)
            and isinstance(argument.func, ast.Attribute)
            and argument.func.attr == "Column"
        ),
        None,
    )
    if column is None:
        return
    nullable = _keyword(column, "nullable")
    default = _keyword(column, "server_default")
    if not _is_false(nullable):
        return
    if default is None:
        yield (
            CRITICAL,
            "add_column",
            "a NOT NULL column with no server_default rejects every insert from "
            "running code that does not send it yet",
        )
    else:
        yield (
            WARNING,
            "add_column",
            "a NOT NULL column with a server_default rewrites the whole table on "
            "PostgreSQL below 11, and holds a lock while it does",
        )


def _alter_column_findings(call: ast.Call) -> Iterator[tuple[str, str, str]]:
    if _keyword(call, "new_column_name") is not None:
        yield (
            CRITICAL,
            "alter_column",
            "renames a column, so the running code queries a name that is gone",
        )
    if _keyword(call, "type_") is not None:
        yield (
            CRITICAL,
            "alter_column",
            "changes a column type under the running code, and holds an ACCESS "
            "EXCLUSIVE lock while it rewrites the table",
        )
    nullable = _keyword(call, "nullable")
    if _is_false(nullable) and _keyword(call, "server_default") is None:
        yield (
            CRITICAL,
            "alter_column",
            "tightens the column to NOT NULL with no server_default, so every "
            "insert from running code that omits it fails",
        )


def _create_index_findings(call: ast.Call) -> Iterator[tuple[str, str, str]]:
    if not _is_true(_keyword(call, "postgresql_concurrently")):
        yield (
            WARNING,
            "create_index",
            "a build without postgresql_concurrently=True blocks writes on the "
            "table until it finishes",
        )


# Where the table name sits in each operation's signature: a positional index, or
# the keyword Alembic accepts instead.
_TABLE_ARGUMENT = {
    "create_table": (0, "table_name"),
    "drop_table": (0, "table_name"),
    "drop_column": (0, "table_name"),
    "add_column": (0, "table_name"),
    "alter_column": (0, "table_name"),
    "rename_table": (0, "old_table_name"),
    "create_index": (1, "table_name"),
    "drop_index": (1, "table_name"),
    "create_foreign_key": (1, "source_table"),
    "drop_constraint": (1, "table_name"),
    "create_unique_constraint": (1, "table_name"),
    "create_check_constraint": (1, "table_name"),
    "create_primary_key": (1, "table_name"),
}


def _operation_table(call: ast.Call, operation: str) -> str | None:
    position = _TABLE_ARGUMENT.get(operation)
    if position is None:
        return None
    index, keyword = position
    node: ast.AST | None = None
    if len(call.args) > index:
        node = call.args[index]
    else:
        node = _keyword(call, keyword)
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value.lower()
    return None


_SIMPLE_CRITICAL = {
    "drop_table": "drops a table the running code still reads",
    "drop_column": "drops a column the running code still reads and writes",
    "rename_table": "renames a table, so the running code queries a name that is gone",
    "drop_schema": "drops a schema the running code still reads",
}

_SIMPLE_WARNING = {
    "drop_index": "a query that depended on this index gets slow",
    "drop_constraint": (
        "running code may rely on this constraint, for example in an upsert"
    ),
}


# Operations that name the object they drop in the first argument. A drop whose
# name is created again in the same upgrade is a redefinition, not a removal.
_NAMED_DROPS = {"drop_constraint", "drop_index"}


def _first_name(call: ast.Call) -> str | None:
    if call.args and isinstance(call.args[0], ast.Constant):
        value = call.args[0].value
        return value.lower() if isinstance(value, str) else None
    return None


def _batch_table(
    call: ast.Call, aliases: dict[str, str | None]
) -> tuple[str | None] | None:
    """The table of the `batch_alter_table` block this call sits in, if any."""
    if (
        isinstance(call.func, ast.Attribute)
        and isinstance(call.func.value, ast.Name)
        and call.func.value.id in aliases
    ):
        return (aliases[call.func.value.id],)
    return None


def _call_findings(
    call: ast.Call,
    operation: str,
    table_override: tuple[str | None] | None = None,
) -> Iterator[tuple[str, str, str, str | None, str | None]]:
    """Yield (level, operation, reason, table, name) for one operation call."""
    if operation == EXECUTE_METHOD:
        sql = _literal_sql(call.args[0]) if call.args else None
        if sql is None:
            return
        for level, name, reason, table in _sql_findings(sql):
            yield level, f"execute({name})", reason, table, None
        return

    table = (
        table_override[0]
        if table_override is not None
        else _operation_table(call, operation)
    )
    named = _first_name(call) if operation in _NAMED_DROPS else None
    if operation in _SIMPLE_CRITICAL:
        yield CRITICAL, operation, _SIMPLE_CRITICAL[operation], table, named
        return
    if operation in _SIMPLE_WARNING:
        yield WARNING, operation, _SIMPLE_WARNING[operation], table, named
        return
    if operation == "add_column":
        for level, name, reason in _add_column_findings(call):
            yield level, name, reason, table, None
        return
    if operation == "alter_column":
        for level, name, reason in _alter_column_findings(call):
            yield level, name, reason, table, None
        return
    if operation == "create_index":
        for level, name, reason in _create_index_findings(call):
            yield level, name, reason, table, None


# ------------------------------------------------------------------- file walker


def _batch_aliases(function: ast.AST, roots: set[str]) -> dict[str, str | None]:
    """Map each name bound by `with op.batch_alter_table(...) as batch_op:` to its table.

    A batch operation takes the column as its first argument, not the table, so the
    table has to come from the context manager.
    """
    aliases: dict[str, str | None] = {}
    for node in ast.walk(function):
        if not isinstance(node, (ast.With, ast.AsyncWith)):
            continue
        for item in node.items:
            call = item.context_expr
            if (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Attribute)
                and call.func.attr == "batch_alter_table"
                and isinstance(call.func.value, ast.Name)
                and call.func.value.id in roots
                and isinstance(item.optional_vars, ast.Name)
            ):
                table = None
                if call.args and isinstance(call.args[0], ast.Constant):
                    value = call.args[0].value
                    table = value.lower() if isinstance(value, str) else None
                aliases[item.optional_vars.id] = table
    return aliases


def _reachable_functions(
    module: ast.Module, entrypoint: str
) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    """Return `upgrade()` and every module-level function it can reach.

    Destructive SQL in this tree is often inside a helper such as
    `_retype_column()`, called from `upgrade()`. A helper reached only from
    `downgrade()` is not returned.
    """
    defined: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {
        node.name: node
        for node in module.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    start = defined.get(entrypoint)
    if start is None:
        return []
    reached: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
    seen = {entrypoint}
    queue = [start]
    while queue:
        function = queue.pop()
        reached.append(function)
        for node in ast.walk(function):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                name = node.func.id
                if name in defined and name not in seen:
                    seen.add(name)
                    queue.append(defined[name])
    return reached


_CREATE_NAMED = {
    "create_index",
    "create_foreign_key",
    "create_unique_constraint",
    "create_check_constraint",
    "create_primary_key",
}


def _created(
    functions: Sequence[ast.FunctionDef | ast.AsyncFunctionDef],
    roots_for: dict[int, set[str]],
) -> tuple[set[str], set[str]]:
    """Tables, and constraint or index names, this upgrade path creates itself.

    The running old code cannot read or write a table that this same revision
    creates, so no operation scoped to one of these tables can break a rollout. A
    non-concurrent index on a new, empty table is also free, and PostgreSQL refuses
    CONCURRENTLY inside a transaction anyway.

    A constraint or an index that is dropped and created again under the same name
    is a redefinition, which is how this tree changes an `ondelete` rule.
    """
    tables: set[str] = set()
    names: set[str] = set()
    for function in functions:
        for node in ast.walk(function):
            if not isinstance(node, ast.Call):
                continue
            operation = _call_target(node, roots_for[id(function)])
            if operation == "create_table":
                table = _operation_table(node, operation)
                if table:
                    tables.add(table)
            elif operation in _CREATE_NAMED:
                name = _first_name(node)
                if name:
                    names.add(name)
            elif operation == EXECUTE_METHOD and node.args:
                sql = _literal_sql(node.args[0])
                if sql:
                    tables |= _sql_created_tables(sql)
    return tables, names


def scan_source(source: str, path: str) -> list[Finding]:
    """Scan one revision's source. A file that does not parse is a CRITICAL finding."""
    try:
        module = ast.parse(source)
    except SyntaxError as error:
        return [
            Finding(
                path=path,
                line=error.lineno or 1,
                level=CRITICAL,
                operation="unparseable",
                reason=f"the gate could not parse this revision: {error.msg}",
            )
        ]

    functions = _reachable_functions(module, ENTRYPOINT)
    batch_for = {
        id(function): _batch_aliases(function, OPERATION_ROOTS)
        for function in functions
    }
    roots_for = {
        id(function): OPERATION_ROOTS | set(batch_for[id(function)])
        for function in functions
    }
    created_tables, created_names = _created(functions, roots_for)

    findings: list[Finding] = []
    for function in functions:
        for node in ast.walk(function):
            if not isinstance(node, ast.Call):
                continue
            operation = _call_target(node, roots_for[id(function)])
            if operation is None:
                continue
            override = _batch_table(node, batch_for[id(function)])
            for level, name, reason, table, named in _call_findings(
                node, operation, table_override=override
            ):
                if table is not None and table in created_tables:
                    continue
                if named is not None and named in created_names:
                    continue
                findings.append(
                    Finding(
                        path=path,
                        line=node.lineno,
                        level=level,
                        operation=name,
                        reason=reason,
                    )
                )
    # Deduplicate: a helper called twice from upgrade() is reported once per line.
    unique = sorted(set(findings), key=lambda f: (f.path, f.line, f.level, f.operation))
    return unique


def scan_files(paths: Iterable[Path], root: Path | None = None) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths:
        display = str(path.relative_to(root)) if root else str(path)
        findings.extend(scan_source(path.read_text(encoding="utf-8"), display))
    return findings


def discover_revisions(root: Path) -> list[Path]:
    return sorted(root.glob(f"api/{VERSIONS_GLOB}"))


def repo_root() -> Path:
    # api/scripts/migration_gate.py -> api/scripts -> api -> repo root
    return Path(__file__).resolve().parents[2]


# ------------------------------------------------------------------------- CLI


def _summary(findings: Sequence[Finding], scanned: Sequence[Path | str]) -> dict:
    critical = [finding for finding in findings if finding.level == CRITICAL]
    warning = [finding for finding in findings if finding.level == WARNING]
    critical_files = {finding.path for finding in critical}
    warning_files = {finding.path for finding in warning} - critical_files
    return {
        "approval_label": APPROVAL_LABEL,
        "files_scanned": len(scanned),
        "files_critical": len(critical_files),
        "files_warning": len(warning_files),
        "files_clean": len(scanned) - len(critical_files) - len(warning_files),
        "critical": len(critical),
        "warning": len(warning),
        "findings": [finding.as_dict() for finding in findings],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="migration_gate",
        description=(
            "Flag destructive and write-blocking operations in the upgrade path of "
            "Alembic revisions."
        ),
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="revision files to scan, normally the files a pull request adds",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="scan every revision in the tree instead of the given paths",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root, used by --all and to shorten printed paths",
    )
    parser.add_argument(
        "--approved",
        action="store_true",
        help=(
            f"a reviewer applied the {APPROVAL_LABEL} label. Print every "
            "finding, but exit 0"
        ),
    )
    parser.add_argument(
        "--format",
        choices=("text", "github", "json"),
        default="text",
        help="text for a person, github for check annotations, json for a machine",
    )
    arguments = parser.parse_args(argv)

    root = (arguments.root or repo_root()).resolve()

    if arguments.all:
        paths = discover_revisions(root)
    else:
        paths = [path for path in arguments.paths if path.suffix == ".py"]
    if not arguments.all and not paths:
        if arguments.format == "json":
            print(json.dumps(_summary([], []), indent=2))
        else:
            print("Migration gate: no revision files to scan.")
        return 0

    missing = [path for path in paths if not path.exists()]
    if missing:
        for path in missing:
            print(f"migration_gate: no such file: {path}", file=sys.stderr)
        return 2

    findings = scan_files(paths, root=root if arguments.all else None)
    summary = _summary(findings, paths)
    critical = summary["critical"]

    if arguments.format == "json":
        summary["approved"] = arguments.approved
        summary["passed"] = critical == 0 or arguments.approved
        print(json.dumps(summary, indent=2))
        return 0 if summary["passed"] else 1

    render = Finding.as_github if arguments.format == "github" else Finding.as_text
    for finding in findings:
        print(render(finding))

    print()
    print(
        f"Migration gate: {len(paths)} revision(s) scanned, "
        f"{critical} critical, {summary['warning']} warning."
    )
    if critical == 0:
        print("Migration gate: no destructive operation in an upgrade path. Pass.")
        return 0
    if arguments.approved:
        print(
            f"Migration gate: {critical} critical finding(s), approved by the "
            f"{APPROVAL_LABEL} label. Pass."
        )
        return 0
    print(
        f"Migration gate: {critical} critical finding(s). Fail.\n"
        "\n"
        "A deploy runs these migrations before the new pods start, so the old code\n"
        "runs against the new schema during the rollout. The database does not roll\n"
        "back when the deploy does.\n"
        "\n"
        "Choose one:\n"
        "  1. Split the change, with the expand and contract pattern. Add the new\n"
        "     shape now, write to both shapes, and remove the old shape in a later\n"
        "     release, after every pod runs the new code.\n"
        f"  2. Keep the change and ask a reviewer for the {APPROVAL_LABEL}\n"
        "     label. The label records that someone accepted the downtime risk."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
