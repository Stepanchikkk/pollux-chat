import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { setGlobalDispatcher, ProxyAgent, fetch as undiciFetch } from 'undici';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// ─── Proxy setup ───────────────────────────────────────────
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

// ─── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: isProduction ? false : (process.env.FRONTEND_URL || 'http://localhost:5173'),
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));

// ─── Static files (production) ─────────────────────────────
if (isProduction) {
  app.use(express.static(join(__dirname, '..', 'dist')));
}

// ─── Google AI ─────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// ─── API: Get models ───────────────────────────────────────
app.get('/api/models', async (req, res) => {
  try {
    const fetchOptions = {};
    if (proxyUrl) fetchOptions.dispatcher = new ProxyAgent(proxyUrl);

    const response = await undiciFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}`,
      fetchOptions
    );

    if (!response.ok) throw new Error(`API: ${response.status}`);

    const data = await response.json();

    const models = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .filter(m => !m.name.includes('embedding') && !m.name.includes('aqa') && !m.name.includes('imagen'))
      .map(m => ({
        value: m.name.replace('models/', ''),
        label: m.displayName || m.name.replace('models/', ''),
        description: m.description?.substring(0, 80) || '',
        inputTokens: m.inputTokenLimit || 0,
        outputTokens: m.outputTokenLimit || 0
      }))
      .sort((a, b) => {
        const ver = (v) => v.value.includes('2.5') ? 3 : v.value.includes('2.0') ? 2 : v.value.includes('1.5') ? 1 : 0;
        return ver(b) - ver(a);
      });

    res.json({ models });
  } catch (error) {
    console.error('Models error:', error.message);
    res.json({
      models: [{ value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Fast and capable', inputTokens: 1048576, outputTokens: 8192 }],
      fallback: true
    });
  }
});

// ─── API: Chat ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { model, messages, newMessage } = req.body;
    const modelId = model || 'gemini-2.0-flash';

    console.log(`Chat: model=${modelId}, images=${newMessage?.images?.length || 0}`);

    const geminiModel = genAI.getGenerativeModel({ model: modelId });

    const history = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chat = geminiModel.startChat({
      history: history.length > 1 ? history.slice(0, -1) : []
    });

    const parts = [];

    if (newMessage.images?.length > 0) {
      for (const img of newMessage.images) {
        const match = img.match(/^data:(.+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
    }

    parts.push({ text: newMessage.text || '' });

    const result = await chat.sendMessage(parts);
    const text = (await result.response).text();

    res.json({ reply: text });
  } catch (error) {
    console.error('Chat error:', error.message);

    let msg = 'Failed to get response';
    if (error.message?.includes('location')) msg = 'API blocked. Set HTTPS_PROXY in .env';
    else if (error.message?.includes('API_KEY')) msg = 'Invalid API key';
    else if (error.message?.includes('quota')) msg = 'Quota exceeded';
    else if (error.message?.includes('not found')) msg = `Model "${req.body.model}" not available`;

    res.status(500).json({ error: msg });
  }
});

// ─── API: Health ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: isProduction ? 'production' : 'development' });
});

// ─── SPA fallback (production) ─────────────────────────────
if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'dist', 'index.html'));
  });
}

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
💬 Gemini Chat
────────────────────────
   Port:     ${PORT}
   Mode:     ${isProduction ? 'production' : 'development'}
   API Key:  ${process.env.GOOGLE_API_KEY ? '✓' : '✗'}
   Proxy:    ${proxyUrl || 'none'}
────────────────────────
`);
});
