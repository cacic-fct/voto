import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Service } from './s3.service';

const mockS3Send = jest.fn();
const mockUploadDone = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({ done: mockUploadDone })),
}));

describe('S3Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      S3_ACCESS_KEY: 'access-key',
      S3_BUCKET_NAME: 'cacic-voto',
      S3_ENDPOINT: 'http://s3.test',
      S3_SECRET_KEY: 'secret-key',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates a path-style S3 client from environment configuration', () => {
    new S3Service();

    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'http://s3.test',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
      forcePathStyle: true,
    });
  });

  it('uploads buffers with content length and returns the persisted object size', async () => {
    mockUploadDone.mockResolvedValue(undefined);
    mockS3Send.mockResolvedValue({ ContentLength: 123 });
    const service = new S3Service();
    const body = Buffer.from('image');

    await expect(service.uploadFile('polls/poll-1/image.avif', body, 'image/avif', { pollId: 'poll-1' })).resolves.toEqual({
      key: 'polls/poll-1/image.avif',
      size: 123,
    });

    expect(Upload).toHaveBeenCalledWith({
      client: expect.objectContaining({ send: mockS3Send }),
      params: {
        Bucket: 'cacic-voto',
        Key: 'polls/poll-1/image.avif',
        Body: body,
        ContentType: 'image/avif',
        ContentLength: body.length,
        Metadata: { pollId: 'poll-1' },
      },
    });
    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cacic-voto',
      Key: 'polls/poll-1/image.avif',
    });
  });

  it('uploads streams without forcing content length', async () => {
    mockUploadDone.mockResolvedValue(undefined);
    mockS3Send.mockResolvedValue({});
    const service = new S3Service();
    const body = Readable.from(['image']);

    await expect(service.uploadFile('polls/poll-1/image.avif', body)).resolves.toEqual({
      key: 'polls/poll-1/image.avif',
      size: 0,
    });

    expect(Upload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Body: body,
          ContentLength: undefined,
        }),
      }),
    );
  });

  it('downloads object streams with metadata and content headers', async () => {
    const stream = Readable.from(['image']);
    mockS3Send.mockResolvedValue({
      Body: stream,
      ContentLength: 5,
      ContentType: 'image/avif',
      Metadata: { pollId: 'poll-1' },
    });
    const service = new S3Service();

    await expect(service.downloadFile('polls/poll-1/image.avif')).resolves.toEqual({
      stream,
      contentLength: 5,
      contentType: 'image/avif',
      metadata: { pollId: 'poll-1' },
    });
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cacic-voto',
      Key: 'polls/poll-1/image.avif',
    });
  });

  it('rejects empty object reads', async () => {
    mockS3Send.mockResolvedValue({});
    const service = new S3Service();

    await expect(service.downloadFile('missing.avif')).rejects.toThrow('File not found or empty.');
  });

  it('deletes configured objects', async () => {
    mockS3Send.mockResolvedValue({});
    const service = new S3Service();

    await expect(service.deleteFile('polls/poll-1/image.avif')).resolves.toBeUndefined();
    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cacic-voto',
      Key: 'polls/poll-1/image.avif',
    });
  });

  it('fails fast when S3 configuration is incomplete', async () => {
    process.env = { ...originalEnv, S3_ENDPOINT: 'http://s3.test' };
    const service = new S3Service();

    await expect(service.deleteFile('polls/poll-1/image.avif')).rejects.toThrow('S3 configuration is incomplete');
  });
});
