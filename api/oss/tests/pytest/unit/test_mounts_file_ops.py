"""Unit tests for mount file ops.

Two layers:
1. Path-traversal rejection on file/folder paths (pure, no storage).
2. create/upload/list/read/delete roundtrip + folder-marker hiding + cascade
   delete + file-vs-folder distinction, against an in-memory fake that
   implements the ObjectStore interface.

The fake exercises all service-side logic (key namespacing, marker hiding,
cascade, file-vs-folder); the real miniopy-async adapter is thin. Live
SeaweedFS coverage lands in the acceptance suite against the docker-compose
stack.
"""

from typing import List, Tuple
from uuid import UUID, uuid4

import pytest

from oss.src.apis.fastapi.mounts.utils import _content_disposition_attachment
from oss.src.core.mounts import service as mounts_service_module
from oss.src.core.mounts.dtos import Mount, MountArchiveSource, MountFile
from oss.src.core.mounts.service import (
    MountsService,
    _rollup_recent_entries,
    validate_file_path,
)
from oss.src.core.store.dtos import StoreObject
from oss.src.core.mounts.types import (
    MountFileNotFound,
    MountNotFound,
    MountPathInvalid,
)


# ---------------------------------------------------------------------------
# Path validation (pure)
# ---------------------------------------------------------------------------


class TestFilePathValidation:
    def test_valid_filename(self):
        validate_file_path("notes.txt")

    def test_valid_nested(self):
        validate_file_path("src/main.py")

    def test_valid_dotted_dirs(self):
        validate_file_path("a.b/c.d/file.txt")

    def test_rejects_dotdot(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("../secret")

    def test_rejects_dotdot_middle(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("a/../../etc/passwd")

    def test_rejects_absolute(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("/etc/passwd")

    def test_rejects_empty(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("")

    def test_accepts_parentheses_and_brackets(self):
        validate_file_path("app/(auth)/[slug]/page.tsx")

    def test_accepts_at_sign(self):
        validate_file_path("@scope/pkg/index.js")

    def test_accepts_plus_signs(self):
        validate_file_path("c++.md")

    def test_accepts_comma(self):
        validate_file_path("a,b.txt")

    def test_accepts_hash(self):
        validate_file_path("notes#1.txt")

    def test_accepts_tilde(self):
        validate_file_path("~backup")

    def test_accepts_astral_plane_name(self):
        validate_file_path("\U00020000dir/file.txt")

    def test_rejects_empty_interior_segment(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("a//b")

    def test_rejects_dot_segment(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("a/./b")

    def test_rejects_embedded_nul(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("a/b\x00c")

    def test_rejects_control_character(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("a/b\x01c")


class TestContentDispositionHeader:
    @pytest.mark.parametrize(
        "filename",
        [
            "中文报告.zip",
            "photo\U0001f600.zip",
            'a"; DROP TABLE.zip',
            "a\nb.zip",
        ],
    )
    def test_header_is_latin_1_safe_with_utf_8_filename(self, filename):
        header = _content_disposition_attachment(filename)

        header.encode("latin-1")
        assert "filename*=UTF-8''" in header


class TestRollupRecentEntries:
    def test_clone_then_edit_collapses_to_top_directory(self):
        files = [
            MountFile(path="repo/a.txt", mtime=1000, size=1),
            MountFile(path="repo/web/b.txt", mtime=1001, size=1),
            MountFile(path="repo/web/c.txt", mtime=1002, size=1),
            MountFile(path="note.txt", mtime=5000, size=1),
        ]

        by_path = {entry.path: entry for entry in _rollup_recent_entries(files, None)}

        assert by_path["repo"].is_folder is True
        assert "note.txt" in by_path
        assert not by_path["note.txt"].is_folder
        assert not any(path.startswith("repo/") for path in by_path)

    def test_old_plus_fresh_directory_does_not_collapse(self):
        files = [
            MountFile(path="dir/old.txt", mtime=100, size=1),
            MountFile(path="dir/new.txt", mtime=5000, size=1),
            MountFile(path="recent.txt", mtime=5001, size=1),
        ]

        by_path = {entry.path: entry for entry in _rollup_recent_entries(files, None)}

        assert "dir" not in by_path
        assert "dir/old.txt" in by_path
        assert "dir/new.txt" in by_path

    def test_untimed_leaf_blocks_collapse(self):
        files = [
            MountFile(path="batch/a.txt", mtime=1000, size=1),
            MountFile(path="batch/b.txt", mtime=None, size=1),
            MountFile(path="later.txt", mtime=5000, size=1),
        ]

        by_path = {entry.path: entry for entry in _rollup_recent_entries(files, None)}

        assert "batch" not in by_path
        assert "batch/a.txt" in by_path
        assert "batch/b.txt" in by_path

    def test_single_batch_history_produces_no_rollup(self):
        files = [
            MountFile(path="repo/a.txt", mtime=1000, size=1),
            MountFile(path="repo/b.txt", mtime=1001, size=1),
        ]

        result = _rollup_recent_entries(files, None)

        assert all(not entry.is_folder for entry in result)
        assert {entry.path for entry in result} == {"repo/a.txt", "repo/b.txt"}

    def test_shallow_to_deep_resolution_picks_repo_over_repo_web(self):
        files = [
            MountFile(path="repo/a.txt", mtime=1000, size=1),
            MountFile(path="repo/web/b.txt", mtime=1001, size=1),
            MountFile(path="repo/web/c.txt", mtime=1002, size=1),
            MountFile(path="outside.txt", mtime=9000, size=1),
        ]

        result = _rollup_recent_entries(files, None)
        folder_paths = {entry.path for entry in result if entry.is_folder}

        assert folder_paths == {"repo"}


# ---------------------------------------------------------------------------
# In-memory fake storage (same interface as ObjectStore)
# ---------------------------------------------------------------------------


class FakeMountStorage:
    def __init__(self):
        # {bucket: {key: bytes}}
        self._store: dict[str, dict[str, bytes]] = {}

    async def list_objects_v2(self, *, bucket: str, prefix: str) -> List[StoreObject]:
        b = self._store.get(bucket, {})
        return [
            StoreObject(key=k, size=len(v))
            for k, v in b.items()
            if k.startswith(prefix)
        ]

    async def list_objects_page(
        self, *, bucket: str, prefix: str, start_after=None, max_keys: int = 500
    ) -> Tuple[List[StoreObject], bool]:
        # One bounded page in the store's UTF-8 byte order, resuming strictly after `start_after`.
        b = self._store.get(bucket, {})
        keys = sorted(
            (k for k in b if k.startswith(prefix)), key=lambda k: k.encode("utf-8")
        )
        if start_after is not None:
            sa = start_after.encode("utf-8")
            keys = [k for k in keys if k.encode("utf-8") > sa]
        page = keys[:max_keys]
        has_more = len(keys) > max_keys
        return [StoreObject(key=k, size=len(b[k])) for k in page], has_more

    async def list_objects_shallow(self, *, bucket: str, prefix: str):
        # One level under `prefix` (delimiter "/"): immediate files + immediate subdir prefixes.
        # Mirrors the real store: a trailing-slash key is a folder marker / common-prefix (a subdir),
        # INCLUDING the queried prefix's own marker (`key == prefix`), which the descent must not
        # re-list (regression guard for the infinite-loop hang).
        b = self._store.get(bucket, {})
        files: List[StoreObject] = []
        subdirs: set[str] = set()
        for k, v in b.items():
            if not k.startswith(prefix):
                continue
            rest = k[len(prefix) :]
            if "/" in rest:
                subdirs.add(prefix + rest.split("/", 1)[0] + "/")
            elif k.endswith("/"):
                subdirs.add(
                    k
                )  # an empty-folder marker at this level (may equal `prefix`)
            else:
                files.append(StoreObject(key=k, size=len(v)))
        return files, sorted(subdirs)

    async def get_object(self, *, bucket: str, key: str) -> bytes:
        b = self._store.get(bucket, {})
        if key not in b:
            raise MountFileNotFound()
        return b[key]

    async def put_object(self, *, bucket: str, key: str, body: bytes) -> int:
        self._store.setdefault(bucket, {})[key] = body
        return len(body)

    async def delete_keys(self, *, bucket: str, keys: List[str]) -> int:
        b = self._store.get(bucket, {})
        n = 0
        for k in keys:
            if k in b:
                del b[k]
                n += 1
        return n

    async def delete_prefix(self, *, bucket: str, prefix: str) -> int:
        objects = await self.list_objects_v2(bucket=bucket, prefix=prefix)
        return await self.delete_keys(bucket=bucket, keys=[o.key for o in objects])


_BUCKET = "agenta-test"


class _StubDAO:
    def __init__(self, mount: Mount):
        self._mount = mount

    async def fetch_mount(self, *, project_id, mount_id):
        return self._mount


class _MissingMountDAO:
    async def fetch_mount(self, *, project_id, mount_id):
        return None


def _make_mount() -> Mount:
    return Mount(
        id=uuid4(),
        project_id=uuid4(),
        slug="m",
    )


def _make_service(mount: Mount) -> Tuple[MountsService, UUID, UUID]:
    service = MountsService(
        mounts_dao=_StubDAO(mount),
        mounts_store=FakeMountStorage(),
        bucket=_BUCKET,
    )
    return service, mount.project_id, mount.id


# ---------------------------------------------------------------------------
# Archive work list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestArchiveWorkList:
    async def test_missing_mount_raises_during_work_list_build(self):
        pid = uuid4()
        service = MountsService(
            mounts_dao=_MissingMountDAO(),
            mounts_store=FakeMountStorage(),
            bucket=_BUCKET,
        )

        with pytest.raises(MountNotFound):
            await service.build_archive_work_list(
                project_id=pid,
                mounts=[MountArchiveSource(mount_id=uuid4())],
            )

    async def test_zip_paths_include_mount_prefix(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path in ["one.txt", "nested/two.txt"]:
            await service.write_file(
                project_id=pid,
                mount_id=mid,
                path=path,
                content=b"x",
            )

        work = await service.build_archive_work_list(
            project_id=pid,
            mounts=[MountArchiveSource(mount_id=mid, archive_prefix="prefix")],
        )

        assert {zip_path for zip_path, _key, _size, _mtime in work} == {
            "prefix/one.txt",
            "prefix/nested/two.txt",
        }


@pytest.mark.asyncio
class TestArchiveZipSlip:
    async def _work_for_keys(self, keys):
        mount = _make_mount()
        storage = FakeMountStorage()
        service = MountsService(
            mounts_dao=_StubDAO(mount),
            mounts_store=storage,
            bucket=_BUCKET,
        )
        mount_base = service._storage_key(project_id=mount.project_id, mount=mount)
        bucket_store = storage._store.setdefault(_BUCKET, {})
        for key in keys:
            bucket_store[f"{mount_base}{key}"] = b"x"
        return await service.build_archive_work_list(
            project_id=mount.project_id,
            mounts=[MountArchiveSource(mount_id=mount.id)],
        )

    async def test_traversal_keys_are_skipped_not_rewritten(self):
        # `../evil.txt` and `..\evil.txt` (backslash is a separator to Windows extractors) must not
        # produce an entry that escapes the archive root; the safe sibling still ships.
        work = await self._work_for_keys(["good.txt", "../evil.txt", "..\\evil.txt"])

        zip_paths = {zip_path for zip_path, *_rest in work}
        assert zip_paths == {"good.txt"}

    async def test_traversal_key_does_not_alias_a_real_entry(self):
        # `a/../report.txt` must NOT be rewritten to `a/report.txt` — that would overwrite the real
        # `a/report.txt` on extraction. Skipping it leaves the genuine file intact and un-duplicated.
        work = await self._work_for_keys(["a/report.txt", "a/../report.txt"])

        zip_paths = [zip_path for zip_path, *_rest in work]
        assert zip_paths == ["a/report.txt"]


# ---------------------------------------------------------------------------
# Roundtrip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestMountFileOpsRoundtrip:
    async def test_write_read_list_delete_file(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        written = await service.write_file(
            project_id=pid, mount_id=mid, path="notes.txt", content=b"hello"
        )
        assert written.path == "notes.txt"
        assert written.size == 5

        content = await service.read_file(
            project_id=pid, mount_id=mid, path="notes.txt"
        )
        assert content.content == "hello"

        listing = await service.list_files(project_id=pid, mount_id=mid)
        assert {f.path for f in listing.files} == {"notes.txt"}

        deleted = await service.delete_path(
            project_id=pid, mount_id=mid, path="notes.txt"
        )
        assert deleted.count == 1

        with pytest.raises(MountFileNotFound):
            await service.read_file(project_id=pid, mount_id=mid, path="notes.txt")

    async def test_git_aware_recency_descent_prunes_gitignored_dirs(self):
        # git_aware=True: the recency/flat view descends the tree pruning ignored/plumbing DIRECTORIES
        # at the store level (never enumerating node_modules), and still drops ignored FILES inside
        # kept dirs. (git_aware=False keeps them all — covered by test_raw_listing_keeps_everything.)
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path, body in [
            (".gitignore", b"**/node_modules\n*.pyc\n"),
            ("api/main.py", b"x"),
            ("api/main.pyc", b"x"),  # gitignored FILE inside a kept dir
            ("web/index.ts", b"x"),
            ("web/node_modules/react/index.js", b"x"),  # gitignored DIR — never listed
            (".git/HEAD", b"x"),  # plumbing — never listed
        ]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=body
            )

        listing = await service.list_files(
            project_id=pid, mount_id=mid, order="path", limit=100, git_aware=True
        )
        assert {f.path for f in listing.files} == {
            ".gitignore",
            "api/main.py",
            "web/index.ts",
        }
        assert listing.total == 3

    async def test_raw_listing_keeps_git_and_ignored_by_default(self):
        # Default (git_aware=False) is the plain-endpoint contract: EVERY object under the prefix, incl.
        # `.git` plumbing and `.gitignore`-matched paths — nothing is pruned for other API consumers.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path, body in [
            (".gitignore", b"**/node_modules\n"),
            ("api/main.py", b"x"),
            ("web/node_modules/react/index.js", b"x"),
            (".git/HEAD", b"x"),
        ]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=body
            )
        listing = await service.list_files(
            project_id=pid, mount_id=mid, order="path", limit=100
        )
        assert {f.path for f in listing.files} == {
            ".gitignore",
            "api/main.py",
            "web/node_modules/react/index.js",
            ".git/HEAD",
        }

    async def test_git_aware_recency_descent_survives_folder_markers(self):
        # An empty-folder marker (a trailing-slash object, incl. a directory's own marker) must NOT
        # send the git_aware descent into an infinite re-list loop — it would hang the request.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        await service.write_file(
            project_id=pid, mount_id=mid, path="a/x.py", content=b"y"
        )
        await service.create_folder(
            project_id=pid, mount_id=mid, path="a"
        )  # creates the "a/" marker
        await service.create_folder(
            project_id=pid, mount_id=mid, path="empty"
        )  # empty folder marker
        listing = await service.list_files(
            project_id=pid, mount_id=mid, order="path", limit=100, git_aware=True
        )
        assert {f.path for f in listing.files} == {"a/x.py"}

    async def test_count_only_returns_total_no_files(self):
        # limit=0 → a bounded COUNT: the real-file total, no file payload, not capped for a small tree.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path in ["a.txt", "b.txt", "sub/c.txt", "node_modules/x/y.js"]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=b"x"
            )
        # node_modules isn't gitignored here (no .gitignore) so it counts under git_aware too.
        listing = await service.list_files(
            project_id=pid, mount_id=mid, limit=0, git_aware=True
        )
        assert listing.total == 4
        assert listing.total_capped is False
        assert listing.files == []

    async def test_raw_count_only_caps_total(self, monkeypatch):
        monkeypatch.setattr(mounts_service_module, "_COUNT_CAP", 3)
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=b"x"
            )

        listing = await service.list_files(
            project_id=pid, mount_id=mid, limit=0, git_aware=False
        )

        assert listing.total == 3
        assert listing.total_capped is True
        assert listing.files == []

    async def test_raw_count_only_reports_uncapped_total_below_cap(self, monkeypatch):
        monkeypatch.setattr(mounts_service_module, "_COUNT_CAP", 3)
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path in ["a.txt", "b.txt"]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=b"x"
            )

        listing = await service.list_files(
            project_id=pid, mount_id=mid, limit=0, git_aware=False
        )

        assert listing.total == 2
        assert listing.total_capped is False
        assert listing.files == []

    async def test_raw_count_only_ignores_trailing_folder_markers(self, monkeypatch):
        # Exactly `_COUNT_CAP` real files followed only by folder markers is an EXACT count, not a
        # floor: the object-level `has_more` (markers still to page) must not report a false "N+".
        monkeypatch.setattr(mounts_service_module, "_COUNT_CAP", 3)
        mount = _make_mount()
        storage = FakeMountStorage()
        service = MountsService(
            mounts_dao=_StubDAO(mount),
            mounts_store=storage,
            bucket=_BUCKET,
        )
        pid, mid = mount.project_id, mount.id
        for path in ["a.txt", "b.txt", "c.txt"]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=b"x"
            )
        # More markers than one store page (max(cap, 200)) so the first page reports has_more=True.
        mount_base = service._storage_key(project_id=pid, mount=mount)
        bucket_store = storage._store.setdefault(_BUCKET, {})
        for i in range(250):
            bucket_store[f"{mount_base}zzz{i:04}/"] = b""

        listing = await service.list_files(
            project_id=pid, mount_id=mid, limit=0, git_aware=False
        )

        assert listing.total == 3
        assert listing.total_capped is False
        assert listing.files == []

    async def test_shallow_depth_lists_top_level_only(self):
        # depth=1 → ONE delimiter level: top-level files + folders, no descent into subtrees. The
        # nested `sub/c.txt` surfaces its parent `sub` as a folder (never the deep file), and a
        # huge dump under `node_modules/` costs exactly one folder entry, not an enumeration.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path in ["a.txt", "b.txt", "sub/c.txt", "node_modules/x/y.js"]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=b"x"
            )
        listing = await service.list_files(project_id=pid, mount_id=mid, depth=1)
        by_path = {f.path: f for f in listing.files}
        assert set(by_path) == {"a.txt", "b.txt", "sub", "node_modules"}
        assert by_path["a.txt"].is_folder is False
        assert by_path["sub"].is_folder is True
        assert by_path["node_modules"].is_folder is True
        assert listing.total == 4

    async def test_shallow_depth_git_aware_prunes_gitignored_children(self):
        # depth=1 + git_aware prunes immediate children by `.git`, internals, AND repo `.gitignore`
        # (ancestor rules included) — so `node_modules` stays hidden while browsing, one level at a
        # time. git_aware=False keeps them (the raw contract) — see the test above.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path, body in [
            (".gitignore", b"node_modules/\n"),
            ("src/app.py", b"x"),
            ("node_modules/react/index.js", b"x"),
            (".git/HEAD", b"x"),
        ]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=body
            )
        listing = await service.list_files(
            project_id=pid, mount_id=mid, depth=1, git_aware=True
        )
        assert {f.path for f in listing.files} == {".gitignore", "src"}

    async def test_shallow_depth_include_gitignored_keeps_ignored_hides_git(self):
        # include_gitignored (the "show git-ignored files" toggle) surfaces `.gitignore`-matched
        # entries again — but `.git` plumbing and internals stay hidden regardless.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path, body in [
            (".gitignore", b"node_modules/\n"),
            ("src/app.py", b"x"),
            ("node_modules/react/index.js", b"x"),
            (".git/HEAD", b"x"),
        ]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=body
            )
        listing = await service.list_files(
            project_id=pid,
            mount_id=mid,
            depth=1,
            git_aware=True,
            include_gitignored=True,
        )
        # node_modules now shows (gitignore not applied); `.git` still pruned.
        assert {f.path for f in listing.files} == {".gitignore", "src", "node_modules"}

    async def test_gitignore_file_survives_dotstar_rule(self):
        # A repo whose `.gitignore` starts with `.*` (ignore ALL dotfiles) matches `.gitignore`
        # ITSELF in pathspec — but git keeps a tracked one, and the drawer needs it visible to detect
        # a git folder. So `.gitignore` stays; a plain ignored dotfile (`.env`) is still pruned.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path, body in [
            (".gitignore", b".*\n!.github/\n"),
            (".env", b"secret"),
            (".github/ci.yml", b"x"),
            ("src/app.py", b"x"),
        ]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=body
            )
        listing = await service.list_files(
            project_id=pid, mount_id=mid, depth=1, git_aware=True
        )
        assert {f.path for f in listing.files} == {".gitignore", ".github", "src"}

    async def test_shallow_depth_with_counts_reports_immediate_children(self):
        # with_counts attaches item_count = the folder's own immediate (pruned) child count, via one
        # shallow list per subdir — NOT a recursive descent. `a/` has 3 immediate children (2 files +
        # the `nested` folder); `.git` inside it is not counted under git_aware.
        mount = _make_mount()
        service, pid, mid = _make_service(mount)
        for path in [
            "a/one.txt",
            "a/two.txt",
            "a/nested/deep.txt",
            "a/.git/HEAD",
            "b/only.txt",
        ]:
            await service.write_file(
                project_id=pid, mount_id=mid, path=path, content=b"x"
            )
        listing = await service.list_files(
            project_id=pid, mount_id=mid, depth=1, with_counts=True, git_aware=True
        )
        by_path = {f.path: f for f in listing.files}
        assert by_path["a"].item_count == 3  # one.txt, two.txt, nested/ (not .git)
        assert by_path["b"].item_count == 1

    async def test_key_is_namespaced_under_mount_prefix(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        await service.write_file(
            project_id=pid, mount_id=mid, path="notes.txt", content=b"x"
        )
        stored_keys = list(service.mounts_store._store[_BUCKET].keys())
        # Key is derived from identity: mounts/<project_id>/<mount_id>/<path>.
        assert stored_keys == [f"mounts/{pid}/{mid}/notes.txt"]

    async def test_create_folder_hidden_from_files_listing(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        created = await service.create_folder(
            project_id=pid, mount_id=mid, path="workspace"
        )
        assert created.path == "workspace"

        listing = await service.list_files(project_id=pid, mount_id=mid)
        # The bare trailing-slash marker must NOT appear as a file row.
        file_rows = [f for f in listing.files if not f.is_folder]
        assert all(not f.path.endswith("/") for f in file_rows)
        assert not file_rows
        # It surfaces as a folder entry instead.
        folder_rows = [f for f in listing.files if f.is_folder]
        assert any(f.path == "workspace" for f in folder_rows)

    async def test_upload_into_folder_then_cascade_delete(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        await service.create_folder(project_id=pid, mount_id=mid, path="workspace")
        await service.write_file(
            project_id=pid,
            mount_id=mid,
            path="workspace/data.bin",
            content=b"\x00\x01\x02",
        )

        listing = await service.list_files(
            project_id=pid, mount_id=mid, path="workspace"
        )
        assert any(f.path == "workspace/data.bin" for f in listing.files)

        deleted = await service.delete_path(
            project_id=pid, mount_id=mid, path="workspace"
        )
        # Cascades: marker + contained file.
        assert deleted.count >= 2

        after = await service.list_files(project_id=pid, mount_id=mid)
        assert not any(f.path.startswith("workspace") for f in after.files)

    async def test_delete_missing_raises(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        with pytest.raises(MountFileNotFound):
            await service.delete_path(project_id=pid, mount_id=mid, path="nope.txt")

    async def test_delete_file_does_not_match_sibling_prefix(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        await service.write_file(project_id=pid, mount_id=mid, path="foo", content=b"a")
        await service.write_file(
            project_id=pid, mount_id=mid, path="foobar", content=b"b"
        )

        deleted = await service.delete_path(project_id=pid, mount_id=mid, path="foo")
        assert deleted.count == 1

        # foobar must survive (foo must not prefix-match it).
        content = await service.read_file(project_id=pid, mount_id=mid, path="foobar")
        assert content.content == "b"

    async def test_traversal_rejected_before_storage(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        with pytest.raises(MountPathInvalid):
            await service.read_file(
                project_id=pid, mount_id=mid, path="../../etc/passwd"
            )
        with pytest.raises(MountPathInvalid):
            await service.write_file(
                project_id=pid, mount_id=mid, path="../escape", content=b"x"
            )
        with pytest.raises(MountPathInvalid):
            await service.delete_path(project_id=pid, mount_id=mid, path="/abs")
