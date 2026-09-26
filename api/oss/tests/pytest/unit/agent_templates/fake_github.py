"""An in-memory GitHub for template import tests: git data API plus raw content."""

import hashlib
import json
from pathlib import Path
from urllib.parse import unquote

import httpx


COMMIT = "0123456789abcdef0123456789abcdef01234567"
OTHER_COMMIT = "fedcba9876543210fedcba9876543210fedcba98"
PACKAGE_PATH = "api/resources/packages/code-qa/1.0.0"


class Symlink:
    def __init__(self, target: str) -> None:
        self.target = target.encode()


class Submodule:
    sha = "1" * 40


def blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


class FakeGitHub:
    """Serves the git data API and raw content for in-memory repositories."""

    def __init__(self) -> None:
        self.repos: dict[str, dict[str, dict]] = {}
        self.trees: dict[str, dict] = {}
        self.blobs: dict[str, bytes] = {}
        self.requests: list[httpx.Request] = []
        self.raw_overrides: dict[str, bytes] = {}
        self.declared_sizes: dict[str, int] = {}
        self.truncated_trees: set[str] = set()
        self.fail_with: httpx.Response | None = None
        self.raise_error: Exception | None = None

    def add_commit(self, repo: str, commit: str, files: dict) -> None:
        self.repos.setdefault(repo, {})[commit] = {"tree": self._tree(files)}

    def _tree(self, node: dict) -> str:
        entries = []
        for name, value in sorted(node.items()):
            if isinstance(value, dict):
                entries.append(
                    {
                        "path": name,
                        "mode": "040000",
                        "type": "tree",
                        "sha": self._tree(value),
                    }
                )
            elif isinstance(value, Symlink):
                sha = blob_sha(value.target)
                self.blobs[sha] = value.target
                entries.append(
                    {
                        "path": name,
                        "mode": "120000",
                        "type": "blob",
                        "sha": sha,
                        "size": len(value.target),
                    }
                )
            elif isinstance(value, Submodule):
                entries.append(
                    {"path": name, "mode": "160000", "type": "commit", "sha": value.sha}
                )
            else:
                sha = blob_sha(value)
                self.blobs[sha] = value
                entries.append(
                    {
                        "path": name,
                        "mode": "100644",
                        "type": "blob",
                        "sha": sha,
                        "size": len(value),
                    }
                )
        sha = hashlib.sha1(json.dumps(entries, sort_keys=True).encode()).hexdigest()
        self.trees[sha] = {"entries": entries}
        return sha

    def _recursive(self, tree_sha: str, prefix: str = "") -> list[dict]:
        result = []
        for entry in self.trees[tree_sha]["entries"]:
            item = {**entry, "path": f"{prefix}{entry['path']}"}
            result.append(item)
            if entry["type"] == "tree":
                result.extend(self._recursive(entry["sha"], f"{item['path']}/"))
        return result

    def _find_blob(self, repo: str, commit: str, path: str) -> bytes | None:
        record = self.repos.get(repo, {}).get(commit)
        if record is None:
            return None
        for entry in self._recursive(record["tree"]):
            if entry["path"] == path and entry["type"] == "blob":
                return self.blobs[entry["sha"]]
        return None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.raise_error is not None:
            raise self.raise_error
        if self.fail_with is not None:
            return self.fail_with
        path = unquote(request.url.path)
        if request.url.host == "raw.githubusercontent.com":
            owner, repo, commit, file_path = path.lstrip("/").split("/", 3)
            if file_path in self.raw_overrides:
                return httpx.Response(200, content=self.raw_overrides[file_path])
            content = self._find_blob(f"{owner}/{repo}", commit, file_path)
            if content is None:
                return httpx.Response(404, text="404: Not Found")
            return httpx.Response(200, content=content)

        assert request.url.host == "api.github.com"
        parts = path.lstrip("/").split("/")
        assert parts[0] == "repos" and parts[3] == "git", path
        repo = f"{parts[1]}/{parts[2]}"
        if repo not in self.repos:
            return httpx.Response(404, json={"message": "Not Found"})
        if parts[4] == "commits":
            record = self.repos[repo].get(parts[5])
            if record is None:
                return httpx.Response(404, json={"message": "Not Found"})
            return httpx.Response(
                200, json={"sha": parts[5], "tree": {"sha": record["tree"]}}
            )
        if parts[4] == "trees":
            tree_sha = parts[5]
            if tree_sha not in self.trees:
                return httpx.Response(404, json={"message": "Not Found"})
            if request.url.params.get("recursive") == "1":
                entries = self._recursive(tree_sha)
            else:
                entries = self.trees[tree_sha]["entries"]
            entries = [
                {
                    **entry,
                    **(
                        {"size": self.declared_sizes[entry["path"]]}
                        if entry["path"] in self.declared_sizes
                        else {}
                    ),
                }
                for entry in entries
            ]
            return httpx.Response(
                200,
                json={
                    "sha": tree_sha,
                    "tree": entries,
                    "truncated": tree_sha in self.truncated_trees,
                },
            )
        return httpx.Response(404, json={"message": "Not Found"})


def package_files() -> dict:
    return {
        "plugin.json": b'{"name": "code-qa", "version": "1.0.0"}',
        "ai.agenta": {
            "agents.json": b'{"agents": {}}',
            "agents": {"code-qa": {"AGENTS.md": b"# Code QA\n"}},
        },
    }


def nest(path: str, leaf: dict) -> dict:
    node = leaf
    for part in reversed(path.split("/")):
        node = {part: node}
    return node


def monorepo(package: dict | None = None) -> dict:
    tree = nest(PACKAGE_PATH, package or package_files())
    # Unrelated siblings at every level must never be listed recursively or downloaded.
    tree["web"] = {f"file-{index}.ts": b"x" * 64 for index in range(500)}
    tree["api"]["other"] = {"big.bin": b"y" * 4096}
    tree["api"]["resources"]["packages"]["other-template"] = {
        "1.0.0": {"plugin.json": b"{}"}
    }
    return tree


def tree_from_directory(root: Path) -> dict:
    tree: dict = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            node = tree
            parts = path.relative_to(root).parts
            for part in parts[:-1]:
                node = node.setdefault(part, {})
            node[parts[-1]] = path.read_bytes()
    return tree
