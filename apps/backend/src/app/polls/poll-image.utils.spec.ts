import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import {
  MAX_POLL_IMAGE_FILE_SIZE_BYTES,
  UploadedPollImageFile,
  assertValidPollImageUpload,
  buildPollImageObjectKey,
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
    expect(isAllowedPollImageMimeType('IMAGE/PNG')).toBe(true);
    expect(isAllowedPollImageMimeType('image/avif')).toBe(true);
    expect(isAllowedPollImageMimeType('image/heic')).toBe(true);
    expect(isAllowedPollImageMimeType('image/heif')).toBe(true);
    expect(isAllowedPollImageMimeType('image/webp')).toBe(true);
    expect(isAllowedPollImageMimeType('image/svg+xml')).toBe(false);
  });

  it('builds stable image object keys from poll and image identifiers', () => {
    expect(buildPollImageObjectKey('poll-1', 'image-1')).toBe('polls/poll-1/images/image-1.avif');
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

  it('rejects missing uploads before reading image data', () => {
    expect(() => assertValidPollImageUpload(undefined)).toThrow(BadRequestException);
  });

  it('normalizes detected MIME types from supported magic bytes', () => {
    const cases: Array<[string, Buffer, string]> = [
      ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'],
      ['gif', Buffer.from('GIF89a', 'ascii'), 'image/gif'],
      ['bmp', Buffer.from('BM0000', 'ascii'), 'image/bmp'],
      ['little-endian tiff', Buffer.from([0x49, 0x49, 0x2a, 0x00]), 'image/tiff'],
      ['big-endian tiff', Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), 'image/tiff'],
      ['webp', Buffer.from('RIFFxxxxWEBP', 'ascii'), 'image/webp'],
      ['avif', Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypavif    ', 'ascii')]), 'image/avif'],
      ['heic', Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypheic    ', 'ascii')]), 'image/heic'],
      ['heif', Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypmif1    ', 'ascii')]), 'image/heif'],
    ];

    for (const [name, buffer, mimeType] of cases) {
      const file = createFile(buffer, 'application/octet-stream');
      assertValidPollImageUpload(file);
      expect(file.mimetype).toBe(mimeType);
      expect(name).toEqual(expect.any(String));
    }
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
