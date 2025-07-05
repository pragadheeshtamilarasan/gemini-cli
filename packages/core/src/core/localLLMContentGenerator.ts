/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';

/**
 * ContentGenerator implementation for local LLM using OpenAI-compatible API
 */
export class LocalLLMContentGenerator implements ContentGenerator {
  private endpoint: string;
  private model: string;
  private apiKey?: string;

  constructor(config: {
    endpoint: string;
    model: string;
    apiKey?: string;
  }) {
    this.endpoint = config.endpoint;
    this.model = config.model;
    this.apiKey = config.apiKey;
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const openaiRequest = this.convertToOpenAIFormat(request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      console.log('🔗 Making request to local LLM:', this.endpoint);
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(openaiRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, message: ${await response.text()}`);
      }

      const data = await response.json();
      return this.convertFromOpenAIFormat(data);
    } catch (error) {
      console.error('Local LLM request failed:', error);
      throw error;
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<any> {
    // For now, just use non-streaming and return a single response
    // We can implement proper streaming later once basic functionality works
    const response = await this.generateContent(request);

    // Return a simple async generator that yields the single response
    return (async function* () {
      yield response;
    })();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Simple token estimation
    const text = JSON.stringify(request.contents || '');
    const estimatedTokens = Math.ceil(text.length / 4);

    return {
      totalTokens: estimatedTokens,
    } as CountTokensResponse;
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // Most local LLMs don't support embeddings
    throw new Error('Embeddings not supported by local LLM');
  }

  private convertToOpenAIFormat(request: GenerateContentParameters): any {
    const messages: any[] = [];

    // Add system instruction if present
    if (request.config?.systemInstruction) {
      messages.push({
        role: 'system',
        content: this.extractText(request.config.systemInstruction),
      });
    }

    // Convert contents to messages
    if (request.contents) {
      const contents = Array.isArray(request.contents) ? request.contents : [request.contents];
      for (const content of contents) {
        if (typeof content === 'string') {
          messages.push({
            role: 'user',
            content: content,
          });
        } else if (content && typeof content === 'object' && 'role' in content) {
          const role = content.role === 'model' ? 'assistant' : content.role;
          const text = this.extractText(content.parts);
          if (text) {
            messages.push({
              role,
              content: text,
            });
          }
        }
      }
    }

    return {
      model: this.model,
      messages,
      max_tokens: request.config?.maxOutputTokens || 4096,
      temperature: request.config?.temperature || 0.7,
      top_p: request.config?.topP || 1.0,
      stream: false, // 👈 ADD THIS LINE
    };
  }

  private convertFromOpenAIFormat(openaiResponse: any): GenerateContentResponse {
    const choice = openaiResponse.choices?.[0];
    if (!choice) {
      throw new Error('No choices in OpenAI response');
    }

    // Handle the exact format your LLM returns
    const text = choice.message?.content || '';
    const finishReason = choice.finish_reason || 'stop';

    // Use type assertion to match Google's expected format
    return {
      candidates: [
        {
          content: {
            parts: [{ text }],
            role: 'model',
          },
          finishReason: finishReason.toUpperCase(), // Convert 'stop' to 'STOP'
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: openaiResponse.usage?.prompt_tokens || 0,
        candidatesTokenCount: openaiResponse.usage?.completion_tokens || 0,
        totalTokenCount: openaiResponse.usage?.total_tokens || 0,
      },
      // Add the missing properties to satisfy the type
      text: text,
      data: undefined,
      functionCalls: [],
      executableCode: undefined,
      codeExecutionResult: undefined,
    } as unknown as GenerateContentResponse;
  }

  private extractText(input: any): string {
    if (typeof input === 'string') {
      return input;
    }

    if (Array.isArray(input)) {
      return input
        .map(item => this.extractText(item))
        .filter(text => text)
        .join('');
    }

    if (input && typeof input === 'object') {
      if (input.text) {
        return input.text;
      }
      if (input.parts) {
        return this.extractText(input.parts);
      }
    }

    return '';
  }
}

export function createLocalLLMContentGenerator(config: {
  endpoint: string;
  model: string;
  apiKey?: string;
}): ContentGenerator {
  return new LocalLLMContentGenerator(config) as ContentGenerator;
}
