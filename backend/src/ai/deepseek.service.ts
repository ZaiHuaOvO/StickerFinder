import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { envBool } from '../database/typeorm.config';

interface ChatMessage {
  role: 'system' | 'user';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

interface DeepseekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/** DeepSeek 调用封装：只负责发送消息和取回文本，不判断业务结果 */
@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('DEEPSEEK_MODEL') ?? 'deepseek-flash';
  }

  get baseUrl(): string {
    return (this.config.get<string>('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com').replace(
      /\/+$/,
      '',
    );
  }

  private get apiKey(): string {
    return (this.config.get<string>('DEEPSEEK_API_KEY') ?? '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey) && envBool(this.config.get<string>('AI_CLASSIFY_ENABLED'), true);
  }

  statusReason(): string {
    if (!this.apiKey) return '缺少 DEEPSEEK_API_KEY';
    if (!envBool(this.config.get<string>('AI_CLASSIFY_ENABLED'), true)) {
      return 'AI_CLASSIFY_ENABLED=false，已关闭 AI 识别';
    }
    return `已配置（${this.model}）`;
  }

  async chatJson(
    systemPrompt: string,
    userText: string,
    imageDataUrls: string[] = [],
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error(`DeepSeek 未配置：${this.statusReason()}`);
    }

    const userContent: ChatMessage['content'] =
      imageDataUrls.length > 0
        ? [
            { type: 'text', text: userText },
            ...imageDataUrls.map(
              (url) => ({ type: 'image_url', image_url: { url } }) as const,
            ),
          ]
        : userText;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await axios.post<DeepseekChatResponse>(
          `${this.baseUrl}/chat/completions`,
          {
            model: this.model,
            messages,
            temperature: 0.1,
            max_tokens: 2500,
            response_format: { type: 'json_object' },
            stream: false,
          },
          {
            timeout: 90_000,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        );
        const content = response.data.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
          throw new Error('DeepSeek 返回内容为空');
        }
        return content;
      } catch (error) {
        lastError = error;
        const message = this.describeError(error);
        this.logger.warn(`DeepSeek 调用失败（第 ${attempt} 次）：${message}`);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
    throw new Error(`DeepSeek 调用失败：${this.describeError(lastError)}`);
  }

  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as DeepseekChatResponse | undefined;
      const apiMessage = data?.error?.message;
      return apiMessage ?? `${error.code ?? 'HTTP_ERROR'} ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
