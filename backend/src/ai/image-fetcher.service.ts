import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, resolve } from 'path';
import { envBool, envInt } from '../database/typeorm.config';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

@Injectable()
export class ImageFetcherService {
  private readonly logger = new Logger(ImageFetcherService.name);

  constructor(private readonly config: ConfigService) {}

  isVisionEnabled(): boolean {
    return envBool(this.config.get<string>('AI_VISION_ENABLED'), false);
  }

  async localImageToDataUrl(path: string, maxBytes: number): Promise<string | null> {
    try {
      const absolute = resolve(path);
      if (!existsSync(absolute)) return null;
      const ext = extname(absolute).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) return null;
      const buffer = await readFile(absolute);
      if (buffer.byteLength > maxBytes) {
        this.logger.warn(`参考图片超过大小限制（${buffer.byteLength} bytes），跳过视觉输入`);
        return null;
      }
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (error) {
      this.logger.warn(`读取参考图片失败：${String(error)}`);
      return null;
    }
  }

  async remoteImageToDataUrl(
    url: string,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<string | null> {
    if (!this.isAllowedImageUrl(url)) {
      return null;
    }
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        maxRedirects: 0,
        headers: { Accept: 'image/*' },
      });
      const contentType = String(response.headers['content-type'] ?? '');
      const mime = contentType.split(';')[0].trim().toLowerCase();
      if (!mime.startsWith('image/')) {
        return null;
      }
      const buffer = Buffer.from(response.data);
      if (buffer.byteLength > maxBytes) {
        return null;
      }
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (error) {
      const safeUrl = url.split('?')[0];
      this.logger.warn(`下载商品图片失败 ${safeUrl}：${String(error)}`);
      return null;
    }
  }

  maxImageBytes(): number {
    return envInt(this.config.get<string>('UPLOAD_MAX_IMAGE_MB'), 5) * 1024 * 1024;
  }

  private isAllowedImageUrl(rawUrl: string): boolean {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    ) {
      return false;
    }
    const allowlist = (this.config.get<string>('IMAGE_HOST_ALLOWLIST') ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (allowlist.length === 0) return false;
    return allowlist.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }
}
