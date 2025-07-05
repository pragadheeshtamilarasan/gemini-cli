#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// --- PRAGA-T Global Configuration (MUST be first!) ---
process.env.USE_LOCAL_LLM = 'true';
process.env.LLM_URL = 'http://site24x7-fgpu:3000/api';
process.env.LLM_MODEL = 'azure.gpt-4.1';
process.env.LLM_API_KEY = 'sk-ae3bb87a98f44a8ba2cf1104d3b9e454';
process.env.BOT_NAME = 'PRAGA-T';

console.log('🦾 PRAGA-T: Local LLM configuration loaded');

// --- Imports AFTER environment setup ---
import './src/gemini.js';
import { main } from './src/gemini.js';

main().catch((error) => {
  console.error('An unexpected critical error occurred:');
  if (error instanceof Error) {
    console.error(error.stack);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
