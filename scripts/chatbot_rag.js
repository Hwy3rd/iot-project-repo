#!/usr/bin/env node
// Public-doc retrieval only: no login, conversation rows, MQTT or production writes.
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server', 'package.json'));
const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
if (envFlag !== -1) {
  if (!args[envFlag + 1]) throw new Error('--env requires a path');
  serverRequire('dotenv').config({ path: path.resolve(args[envFlag + 1]), quiet: true });
  args.splice(envFlag, 2);
} else {
  serverRequire('dotenv').config({ path: path.join(root, 'server', '.env'), quiet: true });
}

async function main() {
  let core;
  try { core = require('../server/dist/modules/chatbot/tools/chatbot-rag.js'); }
  catch { throw new Error('Build server first: cd server; npm run build'); }
  const docsDir = process.env.CHATBOT_DOCS_DIR || path.join(root, 'docs');
  const corpus = await core.loadCorpus(docsDir);
  const command = args[0] || 'corpus';
  if (command === 'corpus') {
    console.log(JSON.stringify({ files: core.CHATBOT_SEARCHABLE_DOCS, chunks: corpus.chunks.length, missing: corpus.missing, fingerprint: corpus.fingerprint }, null, 2));
    return;
  }
  if (!['index', 'query', 'benchmark'].includes(command)) throw new Error('Usage: node scripts/chatbot_rag.js corpus|index|query "question"|benchmark [--env path]');
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is missing. Set it in server/.env or use --env <path>. No semantic benchmark was run.');
    process.exitCode = 1;
    return;
  }
  const { GoogleGenAI } = serverRequire('@google/genai');
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const index = new core.ChatbotRagIndex({
    docsDir,
    indexPath: path.resolve(process.env.CHATBOT_RAG_INDEX_PATH || path.join(root, 'server', '.cache', 'chatbot-rag', 'index.json')),
    topK: Number(process.env.CHATBOT_RAG_TOP_K || 4),
    minScore: Number(process.env.CHATBOT_RAG_MIN_SCORE ?? 0.45),
    timeoutMs: Number(process.env.CHATBOT_RAG_TIMEOUT_MS || 20000),
    onWarning: (message) => console.error(message),
    embed: async (texts, taskType, signal) => {
      const response = await client.models.embedContent({ model: core.RAG_MODEL, contents: texts,
        config: { taskType, outputDimensionality: core.RAG_DIMENSIONS, abortSignal: signal, httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } } } });
      return (response.embeddings || []).map((e) => e.values || []);
    },
  });
  if (command === 'index') {
    console.log(JSON.stringify(await index.prepare(), null, 2));
    return;
  }
  if (command === 'query') {
    if (!args[1]) throw new Error('query requires a question');
    const result = await index.search(args.slice(1).join(' '));
    console.log(JSON.stringify(result, null, 2));
    if (result.method !== 'semantic') process.exitCode = 2;
    return;
  }
  const suite = JSON.parse(await fs.readFile(path.join(root, 'server', 'test', 'chatbot-rag-suite.json'), 'utf8'));
  const results = [];
  for (const item of suite) {
    const started = Date.now();
    const result = await index.search(item.query);
    // A fallback run must never be published as a semantic benchmark.
    if (result.method !== 'semantic') throw new Error('Semantic retrieval failed; no benchmark report written.');
    const rank = result.matches.findIndex((m) => m.file === item.file && m.heading.includes(item.heading)) + 1;
    results.push({ ...item, rank, latencyMs: Date.now() - started, retrieved: result.matches.map((m) => ({ file: m.file, heading: m.heading, score: m.score })) });
  }
  const report = {
    timestamp: new Date().toISOString(), model: core.RAG_MODEL, dimensions: core.RAG_DIMENSIONS,
    fingerprint: corpus.fingerprint, topK: Number(process.env.CHATBOT_RAG_TOP_K || 4),
    note: 'Small curated retrieval development set; one relevant section per question. Does not measure answer correctness, refusal behavior or RBAC.',
    questions: results.length,
    recallAt1: results.filter((r) => r.rank === 1).length / results.length,
    recallAtK: results.filter((r) => r.rank > 0).length / results.length,
    mrr: results.reduce((sum, r) => sum + (r.rank > 0 ? 1 / r.rank : 0), 0) / results.length,
    results,
  };
  await fs.writeFile(path.join(root, 'chatbot_rag_results.json'), JSON.stringify(report, null, 2) + '\n');
  const { results: _, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(() => {
  // SDK errors can contain request details: don't print their payload or key.
  console.error('RAG command failed. Check command arguments, build, public documents and Gemini API configuration. No successful semantic benchmark is claimed.');
  process.exitCode = 1;
});
