import { Injectable } from '@angular/core';
import { OpenRouter } from '@openrouter/sdk';

export interface MediaAttachment {
  name: string;
  url: string;
  type: 'image' | 'video';
  size?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MediaAttachment[];
  reasoning?: string;
  isReasoningOpen?: boolean;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completionTokensDetails?: {
      reasoningTokens?: number;
    };
    reasoning_tokens?: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class Agentconnection {
  private abortController: AbortController | null = null;
  readonly defaultModel = 'minimax/minimax-m3:free';

  /**
   * Stream response from OpenRouter supporting text, images, and video modalities
   */
  async streamChat({
    messages,
    apiKey,
    model = this.defaultModel,
    onChunk,
    onReasoning,
    onUsage,
    onError,
    onComplete
  }: {
    messages: ChatMessage[];
    apiKey: string;
    model?: string;
    onChunk: (content: string) => void;
    onReasoning?: (reasoning: string) => void;
    onUsage?: (usage: any) => void;
    onError?: (error: Error) => void;
    onComplete?: () => void;
  }): Promise<void> {
    if (!apiKey || apiKey.trim() === '') {
      onError?.(new Error('Please provide your OpenRouter API Key in Settings.'));
      return;
    }

    this.abortController = new AbortController();

    // Prepare clean multimodal formatted messages for both SDK (camelCase) and REST
    const sdkMessages = messages
      .filter(m => (m.content && m.content.trim() !== '') || (m.attachments && m.attachments.length > 0))
      .map(m => {
        if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
          const parts: any[] = [];
          const textContent = m.content?.trim() || 'Please analyze the attached media.';
          parts.push({
            type: 'text',
            text: textContent
          });

          m.attachments.forEach(att => {
            if (att.type === 'image') {
              parts.push({
                type: 'image_url',
                imageUrl: {
                  url: att.url
                },
                image_url: {
                  url: att.url
                }
              });
            } else if (att.type === 'video') {
              parts.push({
                type: 'video_url',
                videoUrl: {
                  url: att.url
                },
                video_url: {
                  url: att.url
                }
              });
            }
          });

          return {
            role: 'user',
            content: parts
          };
        }

        return {
          role: m.role,
          content: m.content || ''
        };
      });

    try {
      const openrouter = new OpenRouter({
        apiKey: apiKey.trim()
      });

      // Stream the response to get reasoning tokens in usage
      const stream = await openrouter.chat.send({
        chatRequest: {
          model: model,
          messages: sdkMessages as any,
          stream: true
        }
      });

      for await (const chunk of stream as any) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        const delta = chunk.choices?.[0]?.delta;
        const content = delta?.content;
        const reasoning = delta?.reasoning || delta?.reasoning_content;

        if (reasoning && onReasoning) {
          onReasoning(reasoning);
        }

        if (content) {
          onChunk(content);
        }

        // Usage information comes in the final chunk
        if (chunk.usage) {
          if (onUsage) {
            onUsage(chunk.usage);
          }
          if (chunk.usage.completionTokensDetails?.reasoningTokens) {
            console.log('\nReasoning tokens:', chunk.usage.completionTokensDetails.reasoningTokens);
          }
        }
      }

      onComplete?.();
    } catch (sdkError: any) {
      if (this.abortController?.signal.aborted) {
        onComplete?.();
        return;
      }

      console.warn('SDK stream attempt failed, using direct OpenRouter REST stream fallback:', sdkError);

      try {
        // Direct REST fallback with standard OpenAI-compatible format
        await this.streamViaFetch({
          messages,
          model,
          apiKey,
          onChunk,
          onReasoning,
          onUsage,
          onComplete
        });
      } catch (fetchError: any) {
        if (this.abortController?.signal.aborted) {
          onComplete?.();
          return;
        }

        const errMsg = fetchError?.message || sdkError?.message || String(fetchError);
        console.error('Streaming error in Agentconnection:', fetchError);
        onError?.(new Error(errMsg));
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Direct fetch streaming fallback
   */
  private async streamViaFetch({
    messages,
    model,
    apiKey,
    onChunk,
    onReasoning,
    onUsage,
    onComplete
  }: {
    messages: ChatMessage[];
    model: string;
    apiKey: string;
    onChunk: (chunkText: string) => void;
    onReasoning?: (reasoningText: string) => void;
    onUsage?: (usage: any) => void;
    onComplete?: () => void;
  }): Promise<void> {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4200';

    const restMessages = messages
      .filter(m => (m.content && m.content.trim() !== '') || (m.attachments && m.attachments.length > 0))
      .map(m => {
        if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
          const parts: any[] = [];
          const text = m.content?.trim() || 'Please analyze the attached media.';
          parts.push({ type: 'text', text: text });
          m.attachments.forEach(att => {
            if (att.type === 'image') {
              parts.push({ type: 'image_url', image_url: { url: att.url } });
            } else if (att.type === 'video') {
              parts.push({ type: 'video_url', video_url: { url: att.url } });
            }
          });
          return { role: 'user', content: parts };
        }
        return { role: m.role, content: m.content || '' };
      });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': origin,
        'X-Title': 'AiAgents Pro Chatbot'
      },
      signal: this.abortController?.signal,
      body: JSON.stringify({
        model: model,
        messages: restMessages,
        stream: true
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const msg = errJson.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(msg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable.');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content;
          const reasoning = delta?.reasoning || delta?.reasoning_content;

          if (reasoning && onReasoning) {
            onReasoning(reasoning);
          }

          if (content) {
            onChunk(content);
          }

          if (parsed.usage) {
            onUsage?.(parsed.usage);
          }
        } catch {
          // ignore
        }
      }
    }

    onComplete?.();
  }

  stopGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
