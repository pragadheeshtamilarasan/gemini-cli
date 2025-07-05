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
  Tool,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';
import { writeFileSync } from 'fs';

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

  private logToFile(message: string) {
    try {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] ${message}\n`;
      writeFileSync('/tmp/local-llm-debug.log', logMessage, { flag: 'a' });
    } catch (error) {
      // Ignore file write errors
    }
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    console.error('\n===========================================');
    console.error('🚀 LOCAL LLM GENERATECONTENT CALLED');
    console.error('🚀 Request has tools:', !!request.config?.tools);
    console.error('===========================================\n');

    this.logToFile('LOCAL LLM GENERATECONTENT CALLED');
    this.logToFile(`Request has tools: ${!!request.config?.tools}`);

    const openaiRequest = this.convertToOpenAIFormat(request);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      console.error('🔗 Making request to local LLM:', this.endpoint);
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

    // Check if this is a function call
    const toolCalls = choice.message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      console.log('🔧 Function call detected:', toolCalls[0].function?.name);
      console.log('🔧 Function args:', toolCalls[0].function?.arguments);

      // Handle function call response
      const functionCall = toolCalls[0];
      const functionCallPart = {
        functionCall: {
          name: functionCall.function?.name,
          args: JSON.parse(functionCall.function?.arguments || '{}')
        }
      };

      return {
        candidates: [
          {
            content: {
              parts: text ? [{ text }, functionCallPart] : [functionCallPart],
              role: 'model',
            },
            finishReason: 'STOP', // Function calls always finish to allow execution
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: openaiResponse.usage?.prompt_tokens || 0,
          candidatesTokenCount: openaiResponse.usage?.completion_tokens || 0,
          totalTokenCount: openaiResponse.usage?.total_tokens || 0,
        },
        text: text,
        data: undefined,
        functionCalls: [functionCallPart.functionCall],
        executableCode: undefined,
        codeExecutionResult: undefined,
      } as unknown as GenerateContentResponse;
    }

    // Regular text response
    return {
      candidates: [
        {
          content: {
            parts: [{ text }],
            role: 'model',
          },
          finishReason: finishReason.toUpperCase(),
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: openaiResponse.usage?.prompt_tokens || 0,
        candidatesTokenCount: openaiResponse.usage?.completion_tokens || 0,
        totalTokenCount: openaiResponse.usage?.total_tokens || 0,
      },
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

  private convertToolsToOpenAIFormat(geminiTools: any[]): any[] {
    const openaiTools: any[] = [];

    for (const tool of geminiTools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          // Simplify the parameters structure for better compatibility
          const parameters = {
            type: 'object',
            properties: {},
            required: []
          };

          // Copy properties if they exist
          if (func.parameters && func.parameters.properties) {
            parameters.properties = func.parameters.properties;
          }
          if (func.parameters && func.parameters.required) {
            parameters.required = func.parameters.required;
          }

          openaiTools.push({
            type: 'function',
            function: {
              name: func.name,
              description: func.description || `Execute ${func.name}`,
              parameters: parameters
            }
          });
        }
      }
    }

    return openaiTools;
  }

  private extractFunctionCall(parts: any[]): any | null {
    for (const part of parts) {
      if (part.functionCall) {
        const callId = `call_${Math.random().toString(36).substr(2, 9)}`;
        return {
          id: callId,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        };
      }
    }
    return null;
  }

  private extractFunctionResult(parts: any[]): any | null {
    for (const part of parts) {
      if (part.functionResponse) {
        return {
          id: part.functionResponse.name || `call_${Math.random().toString(36).substr(2, 9)}`,
          result: JSON.stringify(part.functionResponse.response || {})
        };
      }
    }
    return null;
  }
}

export function createLocalLLMContentGenerator(config: {
  endpoint: string;
  model: string;
  apiKey?: string;
}): ContentGenerator {
  return new LocalLLMContentGenerator(config) as ContentGenerator;
}
