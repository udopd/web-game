import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
export const sha256 = (buffer: Uint8Array | string) =>
  createHash("sha256").update(buffer).digest("hex");
export class ObjectStorage {
  private client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  private bucket = process.env.S3_BUCKET ?? "emberfall";
  async init() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
  async put(key: string, bytes: Uint8Array, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
  }
  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error("Object is empty");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  async health() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
