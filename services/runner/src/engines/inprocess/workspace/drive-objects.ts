/**
 * One prefix of the drive, spoken to as the object store it is, with that prefix's own
 * short-lived credentials. The runner mounts nothing for `inprocess`: the few files it writes to
 * the drive itself (Pi's conversation file, the run's skill snapshot) go through this.
 */
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import type { MountCredentials } from "../../sandbox_agent/mount.ts";

/** Deadline for one store call. */
const CALL_TIMEOUT_MS = 30_000;
/** Ask for new credentials this long before the ones in hand expire. */
const RESIGN_BEFORE_EXPIRY_MS = 5 * 60_000;

function notFound(err: unknown): boolean {
  return err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 404 || err.name === "NoSuchKey" || err.name === "NotFound");
}

/** One prefix of the drive as objects, by path relative to the prefix. */
export interface ObjectStore {
  get(rel: string): Promise<Buffer | undefined>;
  put(rel: string, body: Buffer): Promise<void>;
  remove(rel: string): Promise<void>;
  list(relPrefix: string): Promise<Array<{ rel: string; size: number }>>;
}

export class DriveObjects implements ObjectStore {
  private held: { creds: MountCredentials; client: S3Client } | undefined;
  private refreshing: Promise<{ creds: MountCredentials; client: S3Client }> | undefined;

  constructor(private readonly credentials: () => MountCredentials | null | Promise<MountCredentials | null>) {}

  private async target(rel: string): Promise<{ s3: S3Client; bucket: string; key: string; root: string }> {
    const expiresAt = Date.parse(this.held?.creds.expiresAt ?? "");
    if (!this.held || (Number.isFinite(expiresAt) && expiresAt - Date.now() < RESIGN_BEFORE_EXPIRY_MS)) {
      // One refresh for every call that finds the credentials stale. The old client is not
      // destroyed: a call that took it earlier may still be sending on it.
      this.refreshing ??= this.refresh().finally(() => {
        this.refreshing = undefined;
      });
      this.held = await this.refreshing;
    }
    const { creds, client } = this.held;
    const root = creds.prefix.replace(/\/+$/, "");
    return { s3: client, bucket: creds.bucket, key: `${root}/${rel.replace(/^\/+/, "")}`, root: `${root}/` };
  }

  private async refresh(): Promise<{ creds: MountCredentials; client: S3Client }> {
    const creds = await this.credentials();
    if (!creds) throw new Error("the drive's credentials are not available");
    return {
      creds,
      client: new S3Client({
        region: creds.region,
        ...(creds.endpoint ? { endpoint: creds.endpoint, forcePathStyle: true } : {}),
        credentials: { accessKeyId: creds.accessKey, secretAccessKey: creds.secretKey, ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}) },
        maxAttempts: 3,
      }),
    };
  }

  private options() {
    return { abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS) };
  }

  /** The object at `rel`, or undefined when there is none. */
  async get(rel: string): Promise<Buffer | undefined> {
    const { s3, bucket, key } = await this.target(rel);
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), this.options());
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (err) {
      if (notFound(err)) return undefined;
      throw err;
    }
  }

  async put(rel: string, body: Buffer): Promise<void> {
    const { s3, bucket, key } = await this.target(rel);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: body.length }), this.options());
  }

  async remove(rel: string): Promise<void> {
    const { s3, bucket, key } = await this.target(rel);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), this.options());
  }

  /** The objects under `relPrefix` (a folder, with or without its trailing slash), by path relative to the prefix root. */
  async list(relPrefix: string): Promise<Array<{ rel: string; size: number }>> {
    const { s3, bucket, key, root } = await this.target(relPrefix.replace(/\/*$/, "/"));
    const found: Array<{ rel: string; size: number }> = [];
    let token: string | undefined;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: key, ...(token ? { ContinuationToken: token } : {}) }), this.options());
      for (const o of r.Contents ?? []) if (o.Key) found.push({ rel: o.Key.slice(root.length), size: o.Size ?? 0 });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return found;
  }
}
