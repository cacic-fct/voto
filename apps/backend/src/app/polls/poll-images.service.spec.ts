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
      },
    });
    await expect(service.getPollImage('poll-1', 'image-1', { permissions: [], permissionSet: new Set() } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
});
