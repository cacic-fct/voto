import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client?: S3Client;
  private readonly bucketName?: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    const bucketName = process.env.S3_BUCKET_NAME;
    const region = process.env.S3_REGION ?? 'us-east-1';

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
      this.logger.warn(
        'S3 configuration is incomplete. Please check S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET_NAME environment variables.',
      );
      return;
    }

    this.bucketName = bucketName;
    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    this.logger.log(`S3Service initialized with endpoint: ${endpoint}, bucket: ${bucketName}`);
  }

  async uploadFile(
    key: string,
    body: Buffer | Readable,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; size: number }> {
    const { s3Client, bucketName } = this.requireConfig();
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body instanceof Buffer ? body.length : undefined,
        Metadata: metadata,
      },
    });

    await upload.done();
    const headResult = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    this.logger.log(`File uploaded successfully: ${key}`);
    return {
      key,
      size: headResult.ContentLength ?? 0,
    };
  }

  async downloadFile(key: string): Promise<{
    stream: Readable;
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }> {
    const { s3Client, bucketName } = this.requireConfig();
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error('File not found or empty.');
    }

    return {
      stream: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      metadata: response.Metadata,
    };
  }

  async deleteFile(key: string): Promise<void> {
    const { s3Client, bucketName } = this.requireConfig();
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    this.logger.log(`File deleted successfully: ${key}`);
  }

  private requireConfig(): { s3Client: S3Client; bucketName: string } {
    if (!this.s3Client || !this.bucketName) {
      throw new Error(
        'S3 configuration is incomplete. Please check S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET_NAME environment variables.',
      );
    }

    return {
      s3Client: this.s3Client,
      bucketName: this.bucketName,
    };
  }
}
