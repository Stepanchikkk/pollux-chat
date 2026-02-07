import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? false 
    : ['http://localhost:5173', 'http://127.0.0.1:5173']
}));
app.use(express.json({ limit: '50mb' }));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, '../dist')));
}

// Setup proxy if configured - replace global fetch with undici
if (process.env.HTTPS_PROXY) {
  const { ProxyAgent, fetch: undiciFetch } = await import('undici');
  const proxyAgent = new ProxyAgent(process.env.HTTPS_PROXY);
  
  // Replace global fetch with undici fetch that supports proxy
  global.fetch = (url, options = {}) => {
    if (typeof url === 'string' && url.includes('googleapis.com')) {
      options.dispatcher = proxyAgent;
    }
    return undiciFetch(url, options);
  };
  
  console.log('✅ Proxy configured for Google API');
}

// Get API key from request header
function getApiKey(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

// Test API key + return models in one call
app.post('/api/test-key', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ valid: false, error: 'No API key provided' });
  }
  
  try {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');
    const fetchOptions = {};
    
    if (process.env.HTTPS_PROXY) {
      fetchOptions.dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
    }
    
    // Just fetch models list — free call, no quota used
    const response = await undiciFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      fetchOptions
    );
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${response.status}`;
      return res.json({ valid: false, error: msg });
    }
    
    const data = await response.json();
    
    if (!data.models || data.models.length === 0) {
      return res.json({ valid: false, error: 'No models available for this key' });
    }
    
    // Key works — return models immediately
    const models = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .filter(m => !m.name.includes('embedding'))
      .filter(m => !m.name.includes('aqa'))
      .filter(m => !m.name.includes('imagen'))
      .filter(m => !m.name.includes('robotics'))
      .filter(m => !m.name.includes('tts'))
      .map(m => ({
        value: m.name.replace('models/', ''),
        label: m.displayName || m.name.replace('models/', ''),
        description: m.description?.substring(0, 100) || '',
        inputTokens: m.inputTokenLimit,
        outputTokens: m.outputTokenLimit
      }))
      .sort((a, b) => {
        if (a.value.includes('2.5') && !b.value.includes('2.5')) return -1;
        if (!a.value.includes('2.5') && b.value.includes('2.5')) return 1;
        if (a.value.includes('2.0') && !b.value.includes('2.0')) return -1;
        if (!a.value.includes('2.0') && b.value.includes('2.0')) return 1;
        return a.label.localeCompare(b.label);
      });
    
    res.json({ valid: true, models });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// Get available models
app.get('/api/models', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: 'No API key provided' });
  }
  
  try {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');
    const fetchOptions = {};
    
    if (process.env.HTTPS_PROXY) {
      fetchOptions.dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
    }
    
    const response = await undiciFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      fetchOptions
    );
    
    const data = await response.json();
    
    if (!data.models) {
      return res.json({ models: [] });
    }
    
    const textModels = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .filter(m => !m.name.includes('embedding'))
      .filter(m => !m.name.includes('aqa'))
      .filter(m => !m.name.includes('imagen'))
      .map(m => ({
        value: m.name.replace('models/', ''),
        label: m.displayName || m.name.replace('models/', ''),
        description: m.description?.substring(0, 100) || '',
        inputTokens: m.inputTokenLimit,
        outputTokens: m.outputTokenLimit
      }))
      .sort((a, b) => {
        // Sort newer models first
        if (a.value.includes('2.5') && !b.value.includes('2.5')) return -1;
        if (!a.value.includes('2.5') && b.value.includes('2.5')) return 1;
        if (a.value.includes('2.0') && !b.value.includes('2.0')) return -1;
        if (!a.value.includes('2.0') && b.value.includes('2.0')) return 1;
        return a.label.localeCompare(b.label);
      });
    
    res.json({ models: textModels });
  } catch (error) {
    console.error('Models error:', error.message);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Chat endpoint with streaming
app.post('/api/chat', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: 'No API key provided' });
  }
  
  const { model: modelName, messages, newMessage, systemPrompt } = req.body;
  
  if (!modelName || !newMessage) {
    return res.status(400).json({ error: 'Missing model or message' });
  }
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const modelConfig = {};
    if (systemPrompt) {
      modelConfig.systemInstruction = systemPrompt;
    }
    
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      ...modelConfig
    });
    
    // Build chat history
    const history = (messages || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: msg.images?.length 
        ? [
            ...msg.images.map(img => ({
              inlineData: {
                mimeType: 'image/jpeg',
                data: img.replace(/^data:image\/\w+;base64,/, '')
              }
            })),
            { text: msg.content || ' ' }
          ]
        : [{ text: msg.content }]
    }));
    
    // Build new message parts
    const parts = [];
    if (newMessage.images?.length) {
      for (const img of newMessage.images) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: img.replace(/^data:image\/\w+;base64,/, '')
          }
        });
      }
    }
    parts.push({ text: newMessage.text || ' ' });
    
    // Setup streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(parts);
    
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('Chat error:', error.message);
    
    // If headers already sent (streaming started), send error in stream
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 Pollux Chat Server');
  console.log('═'.repeat(40));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Proxy: ${process.env.HTTPS_PROXY || 'Not configured'}`);
  console.log(`🔧 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log('═'.repeat(40));
  console.log('');
});
