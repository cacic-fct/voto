import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import {
  MAX_POLL_IMAGE_FILE_SIZE_BYTES,
  UploadedPollImageFile,
  convertPollImageToAvif,
  isAllowedPollImageMimeType,
} from './poll-image.utils';

describe('poll-image utils', () => {
  let validPngBuffer: Buffer;

  beforeAll(async () => {
    validPngBuffer = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();
  });

  it('accepts relevant raster image MIME types and rejects other uploads early', () => {
    expect(isAllowedPollImageMimeType('image/heic')).toBe(true);
    expect(isAllowedPollImageMimeType('image/heif')).toBe(true);
    expect(isAllowedPollImageMimeType('image/svg+xml')).toBe(false);
  });

  it('validates magic bytes and converts processable images to AVIF', async () => {
    await expect(convertPollImageToAvif(createFile(validPngBuffer, 'image/png'))).resolves.toEqual(
      expect.objectContaining({
        buffer: expect.any(Buffer),
        width: 2,
        height: 1,
        originalMimeType: 'image/png',
      }),
    );
  });

  it('rejects files that are too large or not decodable raster images', async () => {
    await expect(
      convertPollImageToAvif({
        ...createFile(validPngBuffer, 'image/png'),
        size: MAX_POLL_IMAGE_FILE_SIZE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(convertPollImageToAvif(createFile(Buffer.from('not an image'), 'image/png'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

function createFile(buffer: Buffer, mimetype: string): UploadedPollImageFile {
  return {
    buffer,
    mimetype,
    originalname: 'image.png',
    size: buffer.length,
  };
}
