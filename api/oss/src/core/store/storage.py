from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
from json import dumps
from typing import List, Optional, Tuple
from urllib.parse import urlencode, urlparse, urlsplit
from xml.etree import ElementTree

import aiohttp
from miniopy_async import Minio
from miniopy_async.credentials import Credentials
from miniopy_async.signer import sign_v4_sts
from miniopy_async.deleteobjects import DeleteObject
from miniopy_async.error import S3Error

from oss.src.core.store import webidentity
from oss.src.core.mounts.types import MountFileNotFound, MountStorageUnavailable

# STS responses are SOAP-ish XML under the 2011-06-15 namespace; strip it for tag lookups.
_STS_NS = "{https://sts.amazonaws.com/doc/2011-06-15/}"


def _parse_sts_credentials(xml_text: str) -> Credentials:
    """Parse an STS XML response (`AssumeRoleWithWebIdentity`) into a miniopy Credentials.

    Returns the scoped access/secret/session triple plus expiry; raises if the response
    carried no Credentials block (e.g. an STS error document slipped past the status check).
    """
    root = ElementTree.fromstring(xml_text)
    creds_el = root.find(f".//{_STS_NS}Credentials")
    if creds_el is None:
        raise MountStorageUnavailable("STS response carried no credentials.")

    def _text(tag: str) -> Optional[str]:
        el = creds_el.find(f"{_STS_NS}{tag}")
        return el.text if el is not None else None

    expiration = None
    raw_exp = _text("Expiration")
    if raw_exp:
        try:
            expiration = datetime.fromisoformat(raw_exp.replace("Z", "+00:00"))
        except ValueError:
            expiration = None

    return Credentials(
        access_key=_text("AccessKeyId"),
        secret_key=_text("SecretAccessKey"),
        session_token=_text("SessionToken"),
        expiration=expiration,
    )


class ObjectStore:
    """Thin S3-compatible adapter (miniopy-async) for durable object-store contents.

    Speaks the raw S3 protocol against any S3-compatible store (SeaweedFS in dev,
    real S3 / R2 / MinIO in prod) — only the endpoint/credentials differ, resolved
    from env at construction. Works whether or not a sandbox is live.
    """

    def __init__(
        self,
        *,
        endpoint_url: Optional[str],
        access_key: Optional[str],
        secret_key: Optional[str],
        region: str = "us-east-1",
        sts_endpoint_url: Optional[str] = None,
        signing_key: Optional[str] = None,
    ):
        self._endpoint_url = endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        self._region = region
        self._sts_endpoint_url = sts_endpoint_url
        self._signing_key = signing_key

    @property
    def enabled(self) -> bool:
        return bool(self._access_key and self._secret_key)

    @property
    def endpoint_url(self) -> Optional[str]:
        return self._endpoint_url

    @property
    def region(self) -> str:
        return self._region

    @property
    def is_seaweedfs(self) -> bool:
        # The bundled SeaweedFS store is the only backend that signs credentials through its
        # OIDC IAM (AssumeRoleWithWebIdentity), which requires a SIGNING_KEY. A remote
        # S3-compatible store (AWS, MinIO) has none and uses GetFederationToken instead.
        return bool(self._signing_key)

    def _host_secure(self) -> Tuple[str, bool]:
        # miniopy-async wants a scheme-less host:port plus a `secure` flag. The endpoint is
        # always explicit (SeaweedFS defaults it in env; a remote store must set it).
        parsed = urlparse(self._endpoint_url or "")
        host = parsed.netloc or parsed.path
        secure = parsed.scheme != "http"
        return host, secure

    def _client(self) -> Minio:
        if not self.enabled:
            raise MountStorageUnavailable()
        host, secure = self._host_secure()
        return Minio(
            host,
            access_key=self._access_key,
            secret_key=self._secret_key,
            secure=secure,
            region=self._region,
        )

    async def ensure_bucket(self, *, bucket: str) -> None:
        """Create the store bucket if absent (master key).

        The bucket is not lazily created on first write — an STS/mount write to a missing
        bucket fails (AccessDenied for scoped creds, NoSuchBucket for the master key). Call
        once at startup so signed mounts land in an existing bucket.
        """
        if not self.enabled:
            return
        client = self._client()
        if not await client.bucket_exists(bucket):
            await client.make_bucket(bucket)

    def _scope_policy(self, *, bucket: str, prefix: str) -> str:
        """Inline STS session policy scoping credentials to one mount prefix.

        Three statements, and the split matters:
          - ObjRW: object verbs on `<bucket>/<prefix>/*`. `s3:PutObject` authorizes the whole
            multipart upload flow (CreateMultipartUpload / UploadPart / CompleteMultipartUpload
            are S3 API calls, NOT distinct IAM actions — geesefs uploads multipart, but those
            names are invalid in an AWS policy and would be rejected). Only Abort and
            ListMultipartUploadParts exist as their own actions.
          - BktMeta: GetBucketLocation + ListBucketMultipartUploads, UNCONDITIONED. These
            are bucket-level preflights (the S3 client issues GetBucketLocation on first use);
            they carry no `s3:prefix`, so gating them on one denies the preflight and aborts
            every op. They leak only region / in-progress upload ids, not object data.
          - BktListScoped: ListBucket narrowed by `s3:prefix` — the only op where the prefix
            condition is both populated and load-bearing.
        Isolation is enforced by ObjRW's prefix-scoped ARN; a cross-prefix write is denied at
        the object resource, not the bucket.
        """
        scope = f"{prefix.strip('/')}/*"
        return dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "ObjRW",
                        "Effect": "Allow",
                        "Action": [
                            "s3:GetObject",
                            "s3:PutObject",
                            "s3:DeleteObject",
                            "s3:GetObjectAttributes",
                            "s3:AbortMultipartUpload",
                            "s3:ListMultipartUploadParts",
                        ],
                        "Resource": [f"arn:aws:s3:::{bucket}/{scope}"],
                    },
                    {
                        "Sid": "BktMeta",
                        "Effect": "Allow",
                        "Action": [
                            "s3:GetBucketLocation",
                            "s3:ListBucketMultipartUploads",
                        ],
                        "Resource": [f"arn:aws:s3:::{bucket}"],
                    },
                    {
                        "Sid": "BktListScoped",
                        "Effect": "Allow",
                        "Action": ["s3:ListBucket"],
                        "Resource": [f"arn:aws:s3:::{bucket}"],
                        "Condition": {"StringLike": {"s3:prefix": [scope]}},
                    },
                ],
            }
        )

    async def sign_temp_credentials(
        self,
        *,
        bucket: str,
        prefix: str,
        duration_seconds: int = 900,
    ) -> Credentials:
        """STS-sign short-lived credentials scoped to `<bucket>/<prefix>/*`.

        Both backends narrow a bucket-wide identity to one mount prefix with the SAME inline
        session `Policy` (see `_scope_policy`); only the STS verb differs, because the two
        stores authorize different ones (backend chosen by SIGNING_KEY presence, see
        `is_seaweedfs`):

        - SeaweedFS: the API presents a self-minted RS256 web-identity token to the store's
          OIDC IAM via `AssumeRoleWithWebIdentity` (see core/store/webidentity.py).
          `GetFederationToken` is unusable there — SeaweedFS returns actionless tokens.
        - Remote S3-compatible (AWS, MinIO): the API holds S3 credentials, so it calls
          `GetFederationToken` — SigV4-signed with those keys — against the store's STS
          endpoint (the S3 endpoint by default; AWS splits it onto `sts.<region>.*`).

        Isolation rests ENTIRELY on the session policy being present: the identity is
        bucket-wide, so a credential signed without the inline policy inherits the whole bucket
        (every tenant's mount). Fail closed — refuse to sign when no prefix-scoped policy exists.
        """
        if not self.enabled:
            raise MountStorageUnavailable()

        scope_policy = self._scope_policy(bucket=bucket, prefix=prefix)
        if not prefix.strip("/") or not scope_policy:
            raise MountStorageUnavailable(
                "Refusing to sign store credentials without a prefix-scoped session policy."
            )

        if self.is_seaweedfs:
            return await self._sign_web_identity(scope_policy, duration_seconds)
        return await self._sign_federation_token(scope_policy, duration_seconds)

    async def _sign_web_identity(
        self, scope_policy: str, duration_seconds: int
    ) -> Credentials:
        """SeaweedFS path: unauthenticated `AssumeRoleWithWebIdentity` against the store endpoint."""
        host, secure = self._host_secure()
        endpoint = f"{'https' if secure else 'http'}://{host}"
        body = urlencode(
            {
                "Action": "AssumeRoleWithWebIdentity",
                "Version": "2011-06-15",
                "RoleArn": webidentity.role_arn(),
                "RoleSessionName": webidentity.STORE_SUBJECT,
                "WebIdentityToken": webidentity.mint_web_identity_token(),
                "DurationSeconds": str(duration_seconds),
                "Policy": scope_policy,
            }
        )

        async with aiohttp.ClientSession() as session:
            async with session.post(
                endpoint + "/",
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            ) as resp:
                text = await resp.text()
                if resp.status != 200:
                    raise MountStorageUnavailable(
                        f"STS AssumeRoleWithWebIdentity failed ({resp.status})."
                    )

        return _parse_sts_credentials(text)

    async def _sign_federation_token(
        self, scope_policy: str, duration_seconds: int
    ) -> Credentials:
        """Remote-S3 path: SigV4-signed `GetFederationToken` against the store's STS endpoint.

        The STS endpoint defaults to the S3 endpoint (MinIO co-locates STS there); AWS splits
        it onto `sts.<region>.amazonaws.com`, set via AGENTA_STORE_STS_ENDPOINT_URL. Duration is
        clamped to STS's 900s floor. The request is signed with the store's master keys; the
        returned credentials carry only the inline `Policy`'s permissions.
        """
        endpoint = (self._sts_endpoint_url or self._endpoint_url or "").rstrip("/")
        if not endpoint:
            raise MountStorageUnavailable(
                "Refusing to sign: no STS or S3 endpoint configured for the remote store."
            )
        body = urlencode(
            {
                "Action": "GetFederationToken",
                "Version": "2011-06-15",
                "Name": webidentity.STORE_SUBJECT,
                "DurationSeconds": str(max(duration_seconds, 900)),
                "Policy": scope_policy,
            }
        )
        payload = body.encode()
        content_sha256 = sha256(payload).hexdigest()
        url = urlsplit(endpoint + "/")
        now = datetime.now(timezone.utc)
        headers = sign_v4_sts(
            "POST",
            url,
            self._region,
            {
                "Host": url.netloc,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Amz-Date": now.strftime("%Y%m%dT%H%M%SZ"),
            },
            Credentials(
                access_key=self._access_key,
                secret_key=self._secret_key,
            ),
            content_sha256,
            now,
        )

        async with aiohttp.ClientSession() as session:
            async with session.post(
                endpoint + "/", data=payload, headers=headers
            ) as resp:
                text = await resp.text()
                if resp.status != 200:
                    raise MountStorageUnavailable(
                        f"STS GetFederationToken failed ({resp.status})."
                    )

        return _parse_sts_credentials(text)

    async def list_objects_v2(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> List[Tuple[str, int]]:
        """Return (key, size) for every object under `prefix`."""
        client = self._client()
        results: List[Tuple[str, int]] = []
        # list_objects returns an async iterator directly (not a coroutine) and manages its
        # own http session; iterate it, do not `await` or `async with` the client. It can yield
        # a trailing None on an empty/last page, so skip falsy entries.
        async for obj in client.list_objects(bucket, prefix=prefix, recursive=True):
            if obj is None:
                continue
            results.append((obj.object_name, obj.size or 0))
        return results

    async def get_object(
        self,
        *,
        bucket: str,
        key: str,
    ) -> bytes:
        client = self._client()
        # get_object needs an explicit aiohttp session (miniopy-async 1.21 signature) and hands
        # back a streaming ClientResponse; own the session so it outlives the body read.
        async with aiohttp.ClientSession() as session:
            try:
                resp = await client.get_object(bucket, key, session)
            except S3Error as e:
                if e.code in ("NoSuchKey", "NoSuchObject", "NoSuchBucket"):
                    raise MountFileNotFound() from e
                raise
            try:
                return await resp.content.read()
            finally:
                await resp.release()

    async def put_object(
        self,
        *,
        bucket: str,
        key: str,
        body: bytes,
    ) -> int:
        client = self._client()
        await client.put_object(bucket, key, BytesIO(body), length=len(body))
        return len(body)

    async def delete_keys(
        self,
        *,
        bucket: str,
        keys: List[str],
    ) -> int:
        if not keys:
            return 0
        client = self._client()
        # remove_objects is a coroutine returning an async iterator of FAILED deletes (1.21);
        # await it, then drain so the deletes commit.
        errors = await client.remove_objects(
            bucket,
            [DeleteObject(key) for key in keys],
        )
        async for _ in errors:
            pass
        return len(keys)

    async def delete_prefix(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> int:
        """Delete every key under `prefix` (cascades a folder). Returns count."""
        objects = await self.list_objects_v2(bucket=bucket, prefix=prefix)
        keys = [key for key, _ in objects]
        return await self.delete_keys(bucket=bucket, keys=keys)
