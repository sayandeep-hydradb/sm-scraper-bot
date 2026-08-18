import { config } from '../config/env.js';
import { postJson } from './httpClient.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Calls OpenRouter's OpenAI-compatible chat/completions endpoint and returns the
 * assistant message text. Cheap models (default DeepSeek V3.2) make this suitable
 * for high-volume classification like relevance scoring.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; jsonMode?: boolean },
): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.openrouter.model,
    messages,
    temperature: opts?.temperature ?? 0,
  };
  if (opts?.jsonMode) body.response_format = { type: 'json_object' };

  const response = await postJson<ChatCompletionResponse>(`${config.openrouter.baseUrl}/chat/completions`, body, {
    platform: 'openrouter',
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      // Optional attribution headers recommended by OpenRouter.
      'HTTP-Referer': 'https://github.com/hydradb/sm-scraper-bot',
      'X-Title': 'sm-scraper-bot',
    },
  });

  return response.choices?.[0]?.message?.content ?? '';
}
