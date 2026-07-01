import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PollStatus as DbPollStatus } from '@prisma/client';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PollImagesService } from './poll-images.service';
import { UploadedPollImageFile } from './poll-image.utils';

describe('PollImagesService', () => {
  const prisma = {
    poll: {
      findUnique: jest.fn(),
    },
    pollImage: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const s3 = {
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    deleteFile: jest.fn(),
  };
  const user = {
    sub: 'user-1',
    permissions: ['poll#read'],
    permissionSet: new Set(['poll#read']),
  } as never;
  let validFile: UploadedPollImageFile;
  let service: PollImagesService;

  beforeAll(async () => {
    const buffer = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    validFile = {
      buffer,
      mimetype: 'image/png',
      originalname: 'foto.png',
      size: buffer.length,
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PollImagesService(prisma as unknown as PrismaService, s3 as unknown as S3Service);
  });

  it('converts uploads to AVIF, stores metadata, and maps the image URL', async () => {
    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    s3.uploadFile.mockResolvedValue({ key: 'polls/poll-1/images/image-1.avif', size: 321 });
    prisma.pollImage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      altText: null,
      caption: null,
    }));

    await expect(service.uploadPollImage('poll-1', validFile, user)).resolves.toEqual(
      expect.objectContaining({
        url: expect.stringMatching(/^\/api\/polls\/poll-1\/images\//),
        width: 2,
        height: 1,
      }),
    );

    expect(s3.uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^polls\/poll-1\/images\/.+\.avif$/),
      expect.any(Buffer),
      'image/avif',
      expect.objectContaining({
        pollId: 'poll-1',
        uploadedBy: 'user-1',
        originalMimeType: 'image/png',
      }),
    );
    expect(prisma.pollImage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pollId: 'poll-1',
        originalFileName: 'foto.png',
        originalMimeType: 'image/png',
        mimeType: 'image/avif',
        sizeBytes: 321,
        width: 2,
        height: 1,
        createdById: 'user-1',
      }),
    });
  });

  it('rejects uploads from anonymous users and missing polls', async () => {
    await expect(
      service.uploadPollImage('poll-1', validFile, {
        permissions: [],
        permissionSet: new Set(),
        sub: '',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.poll.findUnique).not.toHaveBeenCalled();

    prisma.poll.findUnique.mockResolvedValue(null);

    await expect(service.uploadPollImage('missing-poll', validFile, user)).rejects.toBeInstanceOf(NotFoundException);
    expect(s3.uploadFile).not.toHaveBeenCalled();
  });

  it('deletes the uploaded object when database persistence fails', async () => {
    prisma.poll.findUnique.mockResolvedValue({ id: 'poll-1' });
    s3.uploadFile.mockResolvedValue({ key: 'polls/poll-1/images/image-1.avif', size: 321 });
    prisma.pollImage.create.mockRejectedValue(new Error('db failed'));

    await expect(service.uploadPollImage('poll-1', validFile, user)).rejects.toThrow('db failed');
    expect(s3.deleteFile).toHaveBeenCalledWith('polls/poll-1/images/image-1.avif');
  });

  it('serves eligible published images and blocks reads without access', async () => {
    const stream = Readable.from(['image']);
    prisma.pollImage.findFirst.mockResolvedValue({
      objectKey: 'polls/poll-1/images/image-1.avif',
      mimeType: 'image/avif',
      poll: {
        status: DbPollStatus.PUBLISHED,
        resultsPublic: false,
        visibleFrom: null,
      },
    });
    s3.downloadFile.mockResolvedValue({ stream, contentType: undefined, contentLength: 5 });

    await expect(service.getPollImage('poll-1', 'image-1', user, { allowPublishedRead: true })).resolves.toEqual({
      stream,
      contentType: 'image/avif',
      contentLength: 5,
    });

    await expect(service.getPollImage('poll-1', 'image-1', { permissions: [], permissionSet: new Set() } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.pollImage.findFirst.mockResolvedValue({
      objectKey: 'polls/poll-1/images/image-1.avif',
      mimeType: 'image/avif',
      poll: {
        status: DbPollStatus.DRAFT,
        resultsPublic: false,
        visibleFrom: null,
      },
    });
    await expect(service.getPollImage('poll-1', 'image-1', { permissions: [], permissionSet: new Set() } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows public reads for closed result-public images and blocks future visibility windows', async () => {
    const stream = Readable.from(['image']);
    prisma.pollImage.findFirst.mockResolvedValue({
      objectKey: 'polls/poll-1/images/image-1.avif',
      mimeType: 'image/avif',
      poll: {
        status: DbPollStatus.CLOSED,
        resultsPublic: true,
        visibleFrom: new Date(Date.now() - 1_000),
      },
    });
    s3.downloadFile.mockResolvedValue({ stream, contentType: 'image/custom-avif', contentLength: undefined });

    await expect(service.getPollImage('poll-1', 'image-1', undefined, { allowPublishedRead: true })).resolves.toEqual({
      stream,
      contentType: 'image/custom-avif',
      contentLength: undefined,
    });

    prisma.pollImage.findFirst.mockResolvedValue({
      objectKey: 'polls/poll-1/images/image-1.avif',
      mimeType: 'image/avif',
      poll: {
        status: DbPollStatus.PUBLISHED,
        resultsPublic: false,
        visibleFrom: new Date(Date.now() + 60_000),
      },
    });

    await expect(service.getPollImage('poll-1', 'image-1', undefined, { allowPublishedRead: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects image reads when the database row is missing', async () => {
    prisma.pollImage.findFirst.mockResolvedValue(null);

    await expect(service.getPollImage('poll-1', 'missing-image', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes image rows and storage objects', async () => {
    prisma.pollImage.findFirst.mockResolvedValue({ objectKey: 'polls/poll-1/images/image-1.avif' });
    prisma.pollImage.delete.mockResolvedValue({});

    await expect(service.deletePollImage('poll-1', 'image-1')).resolves.toBeUndefined();
    expect(prisma.pollImage.delete).toHaveBeenCalledWith({ where: { id: 'image-1' } });
    expect(s3.deleteFile).toHaveBeenCalledWith('polls/poll-1/images/image-1.avif');

    prisma.pollImage.findFirst.mockResolvedValue(null);
    await expect(service.deletePollImage('poll-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deduplicates best-effort object deletion and swallows storage failures', async () => {
    s3.deleteFile.mockRejectedValueOnce(new Error('storage offline')).mockResolvedValue(undefined);

    await expect(service.deleteObjectKeysBestEffort(['same-key', 'same-key', 'other-key'])).resolves.toBeUndefined();

    expect(s3.deleteFile).toHaveBeenCalledTimes(2);
    expect(s3.deleteFile).toHaveBeenNthCalledWith(1, 'same-key');
    expect(s3.deleteFile).toHaveBeenNthCalledWith(2, 'other-key');
  });

  it('maps optional alt text and captions into public image contracts', () => {
    expect(
      service.toContractImage({
        altText: 'Mesa de votação',
        caption: 'Assembleia geral',
        height: 240,
        id: 'image/1',
        mimeType: 'image/avif',
        objectKey: 'polls/poll 1/images/image.avif',
        pollId: 'poll 1',
        width: 320,
      }),
    ).toEqual({
      id: 'image/1',
      url: '/api/polls/poll%201/images/image%2F1',
      width: 320,
      height: 240,
      altText: 'Mesa de votação',
      caption: 'Assembleia geral',
    });
  });
});
