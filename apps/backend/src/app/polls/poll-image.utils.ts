import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export type UploadedPollImageFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export const MAX_POLL_IMAGE_FILE_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_POLL_IMAGE_DIMENSION_PIXELS = 12_000;
export const MAX_POLL_IMAGE_DECODED_PIXELS = 40_000_000;
const POLL_IMAGE_METADATA_TIMEOUT_SECONDS = 5;
const POLL_IMAGE_CONVERSION_TIMEOUT_SECONDS = 15;

const POLL_IMAGE_SHARP_INPUT_OPTIONS = {
  animated: false,
  failOn: 'warning',
  limitInputPixels: MAX_POLL_IMAGE_DECODED_PIXELS,
  pages: 1,
  sequentialRead: true,
  unlimited: false,
} as const;

const ALLOWED_POLL_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
]);

export function isAllowedPollImageMimeType(mimeType: string): boolean {
  return ALLOWED_POLL_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export async function convertPollImageToAvif(file: UploadedPollImageFile | undefined): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  originalMimeType: string;
}> {
  assertValidPollImageUpload(file);
  const originalMimeType = detectPollImageMimeType(file.buffer);
  if (!originalMimeType) {
    throw new BadRequestException('A imagem precisa estar em um formato raster suportado.');
  }

  const metadata = await readProcessablePollImageMetadata(file.buffer);
  const { data, info } = await runPollImageOperation(
    createPollSharp(file.buffer)
      .rotate()
      .avif({
        quality: 62,
        effort: 4,
      })
      .timeout({ seconds: POLL_IMAGE_CONVERSION_TIMEOUT_SECONDS })
      .toBuffer({ resolveWithObject: true }),
    'Conversão da imagem para AVIF',
  );

  return {
    buffer: data,
    width: info.width || metadata.width,
    height: info.height || metadata.height,
    originalMimeType,
  };
}

export function assertValidPollImageUpload(file: UploadedPollImageFile | undefined): asserts file is UploadedPollImageFile {
  if (!file) {
    throw new BadRequestException('Selecione uma imagem para enviar.');
  }

  if (file.size > MAX_POLL_IMAGE_FILE_SIZE_BYTES) {
    throw new BadRequestException('A imagem deve ter no máximo 15 MB.');
  }

  const detectedMimeType = detectPollImageMimeType(file.buffer);
  if (!detectedMimeType || !ALLOWED_POLL_IMAGE_MIME_TYPES.has(detectedMimeType)) {
    throw new BadRequestException('A imagem precisa estar em um formato raster suportado.');
  }

  file.mimetype = detectedMimeType;
}

export function buildPollImageObjectKey(pollId: string, imageId: string): string {
  return `polls/${pollId}/images/${imageId}.avif`;
}

function createPollSharp(buffer: Buffer): ReturnType<typeof sharp> {
  return sharp(buffer, POLL_IMAGE_SHARP_INPUT_OPTIONS);
}

async function readProcessablePollImageMetadata(buffer: Buffer): Promise<{
  width: number;
  height: number;
  pages?: number;
}> {
  const metadata = await runPollImageOperation(
    createPollSharp(buffer).timeout({ seconds: POLL_IMAGE_METADATA_TIMEOUT_SECONDS }).metadata(),
    'Leitura da imagem',
  );

  if (!metadata.width || !metadata.height) {
    throw new BadRequestException('Não foi possível identificar as dimensões da imagem.');
  }

  if (metadata.pages && metadata.pages > 1) {
    throw new BadRequestException('Imagens animadas ou com múltiplas páginas não são aceitas.');
  }

  if (metadata.width > MAX_POLL_IMAGE_DIMENSION_PIXELS || metadata.height > MAX_POLL_IMAGE_DIMENSION_PIXELS) {
    throw new BadRequestException(`A imagem deve ter no máximo ${MAX_POLL_IMAGE_DIMENSION_PIXELS}px por lado.`);
  }

  if (metadata.width * metadata.height > MAX_POLL_IMAGE_DECODED_PIXELS) {
    throw new BadRequestException('A imagem tem pixels demais para ser processada com segurança.');
  }

  return {
    width: metadata.width,
    height: metadata.height,
    pages: metadata.pages,
  };
}

async function runPollImageOperation<T>(operation: Promise<T>, operationName: string): Promise<T> {
  try {
    return await operation;
  } catch (error: unknown) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    if (isSharpTimeoutError(error)) {
      throw new BadRequestException(`${operationName} excedeu o tempo limite.`);
    }

    if (isSharpInputLimitError(error)) {
      throw new BadRequestException('A imagem excede os limites de processamento.');
    }

    throw new BadRequestException(`${operationName} falhou. Envie uma imagem válida.`);
  }
}

function isSharpTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('timeout');
}

function isSharpInputLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('pixel limit') || message.includes('memory limit') || message.includes('exceeds');
}

function detectPollImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length < 4) {
    return undefined;
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif';
  }

  if (buffer.subarray(0, 2).toString('ascii') === 'BM') {
    return 'image/bmp';
  }

  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  ) {
    return 'image/tiff';
  }

  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brands = buffer.subarray(8, Math.min(buffer.length, 32)).toString('ascii');
    if (/\b(?:avif|avis)\b/.test(brands)) {
      return 'image/avif';
    }

    if (/\b(?:heic|heix|hevc|hevx|mif1|msf1)\b/.test(brands)) {
      return brands.includes('mif1') || brands.includes('msf1') ? 'image/heif' : 'image/heic';
    }
  }

  return undefined;
}
