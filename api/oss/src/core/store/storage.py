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
from miniopy_async.deleteobjects import DeleteObject
from miniopy_async.error import S3Error
from miniopy_async.signer import sign_v4_sts

from oss.src.core.mounts.types import MountFileNotFound, MountStorageUnavailable

# STS responses are SOAP-ish XML under the 2011-06-15 namespace; strip it for tag lookups.
_STS_NS = "{https://sts.amazonaws.com/doc/2011-06-15/}"


def _parse_federation_token(xml_text: str) -> Credentials:
    """Parse a GetFederationToken XML response into a miniopy Credentials.

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
    ):
        self._endpoint_url = endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        self._region = region

    @property
    def enabled(self) -> bool:
        return bool(self._access_key and self._secret_key)

    @property
    def endpoint_url(self) -> Optional[str]:
        return self._endpoint_url

    @property
    def region(self) -> str:
        return self._region

    def _host_secure(self) -> Tuple[str, bool]:
        # miniopy-async wants a scheme-less host:port plus a `secure` flag; an empty
        # endpoint_url means real AWS S3 (the SDK default host, always TLS).
        if self._endpoint_url:
            parsed = urlparse(self._endpoint_url)
            host = parsed.netloc or parsed.path
            secure = parsed.scheme != "http"
        else:
            host = "s3.amazonaws.com"
            secure = True
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

    def _scope_policy(self, *, bucket: str, prefix: str) -> str:
        resource = f"arn:aws:s3:::{bucket}/{prefix.strip('/')}/*"
        return dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                        "Resource": [resource],
                    },
                    {
                        "Effect": "Allow",
                        "Action": ["s3:ListBucket"],
                        "Resource": [f"arn:aws:s3:::{bucket}"],
                        "Condition": {
                            "StringLike": {"s3:prefix": [f"{prefix.strip('/')}/*"]}
                        },
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

        Calls `GetFederationToken` (NOT `AssumeRole`) on the store's STS endpoint — the
        federation path federates the caller's OWN identity with an inline policy, so it
        needs no pre-defined roles/trust policies (which `AssumeRole` requires and which
        SeaweedFS's released build does not ship by default). One path for every store:
        AWS S3, R2, and SeaweedFS all answer GetFederationToken on the same S3 endpoint
        (SeaweedFS serves STS in-process when a signing key is configured). The master key
        signs the request and never leaves the API; the returned scoped key pair + session
        token are what reach the runner.
        """
        if not self.enabled:
            raise MountStorageUnavailable()

        host, secure = self._host_secure()
        endpoint = f"{'https' if secure else 'http'}://{host}"
        body = urlencode(
            {
                "Action": "GetFederationToken",
                "Version": "2011-06-15",
                "Name": "agenta-mount",
                "DurationSeconds": str(duration_seconds),
                "Policy": self._scope_policy(bucket=bucket, prefix=prefix),
            }
        )

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        signed = sign_v4_sts(
            "POST",
            urlsplit(endpoint + "/"),
            self._region,
            {
                "Content-Type": "application/x-www-form-urlencoded",
                "Host": host,
                "X-Amz-Date": now.strftime("%Y%m%dT%H%M%SZ"),
            },
            Credentials(self._access_key, self._secret_key),
            sha256(body.encode()).hexdigest(),
            now,
        )

        async with aiohttp.ClientSession() as session:
            async with session.post(endpoint + "/", data=body, headers=signed) as resp:
                text = await resp.text()
                if resp.status != 200:
                    raise MountStorageUnavailable(
                        f"STS GetFederationToken failed ({resp.status})."
                    )

        return _parse_federation_token(text)

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
