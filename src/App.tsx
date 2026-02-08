import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Send, Square, RotateCcw, Pencil, Download, Trash2, Plus, 
  Settings, Moon, Sun, Image, X, Check, MessageSquare,
  RefreshCw, Menu, AlertCircle, Copy, ExternalLink,
  Bot, User, ArrowRightLeft
} from 'lucide-react';
import 'highlight.js/styles/github-dark.css';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { useTheme } from './hooks/useTheme';
import { encryptApiKey, decryptApiKey, clearApiKey, hasStoredKey } from './lib/crypto';
import { 
  createChat, getAllChats, getChat, updateChat, deleteChat,
  addMessage, getChatMessages, deleteMessagesAfter, exportChat,
  type Chat, type ChatMessage, deleteMessage 
} from './lib/db';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';
const GLOBAL_SYSTEM_PROMPT_KEY = 'pollux-global-system-prompt';

function getNextUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
}

function loadQuotaStore(): QuotaStore {
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) return { modelQuotas: {} };
    const parsed = JSON.parse(raw) as QuotaStore;
    if (!parsed?.modelQuotas) return { modelQuotas: {} };
    const normalized: Record<string, QuotaInfo> = {};
    Object.entries(parsed.modelQuotas).forEach(([key, value]) => {
      normalized[key] = normalizeQuota(value);
    });
    return { modelQuotas: normalized };
  } catch {
    return { modelQuotas: {} };
  }
}

function saveQuotaStore(store: QuotaStore) {
  localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(store));
}

function normalizeQuota(quota: QuotaInfo): QuotaInfo {
  if (!quota.resetAt) return quota;
  if (Date.now() >= quota.resetAt) {
    return {
      ...quota,
      used: 0,
      remaining: quota.limit ?? null,
      resetAt: quota.limit === null ? null : getNextUtcMidnight(),
      lastUpdated: Date.now()
    };
  }
  return quota;
}

function parseQuotaError(errorText: string) {
  const match = errorText.match(/limit: (\d+)/);
  const limitMatch = match ? parseInt(match[1], 10) : null;

  const quotaValueMatch = errorText.match(/"quotaValue":"(\d+)"/);
  const used = quotaValueMatch ? parseInt(quotaValueMatch[1], 10) : null;

  const retryMatch = errorText.match(/retryDelay["\s:]+(\d+)s/);
  const retrySeconds = retryMatch ? parseInt(retryMatch[1], 10) : null;

  const isPerDay = errorText.includes('PerDay');
  const isPerMinute = errorText.includes('PerMinute');

  return {
    limit: limitMatch,
    used,
    remaining: limitMatch !== null && used !== null ? limitMatch - used : null,
    retryAfter: retrySeconds ? Date.now() + retrySeconds * 1000 : null,
    period: isPerDay ? 'day' : isPerMinute ? 'minute' : 'unknown',
    available: limitMatch !== 0
  };
}

interface Model {
  value: string;
  label: string;
  description: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface QuotaInfo {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  resetAt: number | null;
  lastUpdated: number;
}

interface QuotaStore {
  modelQuotas: Record<string, QuotaInfo>;
}

const QUOTA_STORAGE_KEY = 'pollux-quotas';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  
  // Auth state
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const [checkingKey, setCheckingKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Chat state
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  
  // Model state
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [quotaStore, setQuotaStore] = useState<QuotaStore>(() => loadQuotaStore());
  const [errorBanner, setErrorBanner] = useState('');
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [autoRetryMessage, setAutoRetryMessage] = useState<{
    chatId: string;
    text: string;
    images: string[];
    model: string;
  } | null>(null);
  
  // System prompt
  const [globalSystemPrompt, setGlobalSystemPrompt] = useState('');
  const [chatSystemPrompt, setChatSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  
  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const dragCounter = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(GLOBAL_SYSTEM_PROMPT_KEY);
    if (stored) {
      setGlobalSystemPrompt(stored);
    }
  }, []);

  useEffect(() => {
    saveQuotaStore(quotaStore);
  }, [quotaStore]);

  useEffect(() => {
    const nextReset = getNextUtcMidnight();
    const timeout = window.setTimeout(() => {
      setQuotaStore(prev => {
        const updated: Record<string, QuotaInfo> = {};
        Object.entries(prev.modelQuotas).forEach(([key, value]) => {
          updated[key] = normalizeQuota({ ...value, resetAt: nextReset });
        });
        return { modelQuotas: updated };
      });
    }, Math.max(0, nextReset - Date.now()));
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!retryAt || !autoRetryMessage) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= retryAt) {
        clearInterval(timer);
        const payload = autoRetryMessage;
        if (payload.chatId !== currentChatId) {
          setRetryAt(null);
          setAutoRetryMessage(null);
          setErrorBanner('');
          return;
        }
        setRetryAt(null);
        setAutoRetryMessage(null);
        sendMessage(payload.text, payload.images, payload.model);
      } else {
        setErrorBanner(`⏱️ Повторите через ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} секунд`);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [retryAt, autoRetryMessage, currentChatId]);

  useEffect(() => {
    if (!showModelDropdown) return;
    function handleClickOutside(event: MouseEvent) {
      if (!modelDropdownRef.current) return;
      if (!modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowModelDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showModelDropdown]);

  async function initializeApp() {
    if (hasStoredKey()) {
      const key = await decryptApiKey();
      if (key) {
        setApiKey(key);
        loadChats();
        loadModels(key);
      }
    }
  }

  function updateQuota(modelValue: string, update: Partial<QuotaInfo>) {
    setQuotaStore(prev => {
      const existing = prev.modelQuotas[modelValue];
      const next: QuotaInfo = normalizeQuota({
        limit: update.limit ?? existing?.limit ?? null,
        used: update.used ?? existing?.used ?? null,
        remaining: update.remaining ?? existing?.remaining ?? null,
        resetAt: update.resetAt ?? existing?.resetAt ?? null,
        lastUpdated: Date.now()
      });
      return {
        ...prev,
        modelQuotas: {
          ...prev.modelQuotas,
          [modelValue]: next
        }
      };
    });
  }

  function getQuota(modelValue: string): QuotaInfo | undefined {
    const quota = quotaStore.modelQuotas[modelValue];
    return quota ? normalizeQuota(quota) : undefined;
  }

  function selectFallbackModel(current: string) {
    const fallback = models.find(model => {
      if (model.value === current) return false;
      const quota = getQuota(model.value);
      if (quota?.limit === 0) return false;
      if (quota?.remaining !== null && quota.remaining <= 0) return false;
      return true;
    });
    if (fallback) {
      setSelectedModel(fallback.value);
      setErrorBanner(`Переключено на ${fallback.label} (осталось ${getQuota(fallback.value)?.remaining ?? '—'} запросов)`);
    }
  }

  function getModelLabel(value: string) {
    return models.find(model => model.value === value)?.label ?? value;
  }

  function handleQuotaError(
    errorText: string,
    modelValue: string,
    retryPayload: { text: string; images: string[] }
  ) {
    const quotaInfo = parseQuotaError(errorText);
    if (quotaInfo.limit !== null || quotaInfo.used !== null) {
      updateQuota(modelValue, {
        limit: quotaInfo.limit,
        used: quotaInfo.used,
        remaining: quotaInfo.remaining,
        resetAt: quotaInfo.period === 'day' ? getNextUtcMidnight() : null
      });
    }

    const modelLabel = getModelLabel(modelValue);

    if (quotaInfo.limit === 0) {
      setErrorBanner(`❌ Модель ${modelLabel} недоступна на бесплатном тарифе`);
      selectFallbackModel(modelValue);
      return;
    }

    if (quotaInfo.remaining === 0) {
      setErrorBanner(`⏳ Лимит исчерпан (0/${quotaInfo.limit ?? '—'}). Обновится завтра в 00:00 UTC.`);
      selectFallbackModel(modelValue);
      return;
    }

    if (quotaInfo.retryAfter) {
      setRetryAt(quotaInfo.retryAfter);
      if (currentChatId) {
        setAutoRetryMessage({
          chatId: currentChatId,
          text: retryPayload.text,
          images: retryPayload.images,
          model: modelValue
        });
      }
      setErrorBanner(`⏱️ Повторите через ${Math.max(1, Math.ceil((quotaInfo.retryAfter - Date.now()) / 1000))} секунд`);
      return;
    }

    if (errorText) {
      setErrorBanner('⚠️ Превышен лимит. Попробуйте позже или другую модель.');
    }
  }

  const quotaWarningMessage = useMemo(() => {
    if (!selectedModel) return '';
    const quota = getQuota(selectedModel);
    if (!quota || quota.limit === null || quota.limit === 0 || quota.used === null) return '';
    const usedRatio = quota.limit > 0 ? quota.used / quota.limit : 0;
    if (usedRatio >= 0.8 && quota.remaining !== null && quota.remaining > 0) {
      return `⚠️ Осталось ${quota.remaining} запрос(ов) на сегодня`;
    }
    return '';
  }, [quotaStore, selectedModel]);

  async function loadChats() {
    const allChats = await getAllChats();
    setChats(allChats);
    
    if (allChats.length > 0 && !currentChatId) {
      selectChat(allChats[0].id);
    }
  }

  async function selectChat(chatId: string) {
    setCurrentChatId(chatId);
    const chatMessages = await getChatMessages(chatId);
    setMessages(chatMessages);
    
    const chat = await getChat(chatId);
    if (chat?.systemPrompt) {
      setChatSystemPrompt(chat.systemPrompt);
    } else {
      setChatSystemPrompt('');
    }
  }

  async function handleNewChat() {
    const chat = await createChat(chatSystemPrompt || undefined);
    setChats(prev => [chat, ...prev]);
    setCurrentChatId(chat.id);
    setMessages([]);
    setInput('');
    setImages([]);
  }

  async function handleDeleteChat(chatId: string) {
    await deleteChat(chatId);
    setChats(prev => prev.filter(c => c.id !== chatId));
    
    if (currentChatId === chatId) {
      const remaining = chats.filter(c => c.id !== chatId);
      if (remaining.length > 0) {
        selectChat(remaining[0].id);
      } else {
        setCurrentChatId(null);
        setMessages([]);
      }
    }
  }

  async function loadModels(key: string) {
    setLoadingModels(true);
    try {
      const res = await fetch(`${API_BASE}/api/models`, {
        headers: { Authorization: `Bearer ${key}` }
      });
      const data = await res.json();
      if (data.models?.length) {
        setModels(data.models);
        if (!selectedModel && data.models[0]) {
          setSelectedModel(data.models[0].value);
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleSubmitKey() {
    if (!keyInput.trim()) return;
    
    setCheckingKey(true);
    setKeyError('');
    
    try {
      const res = await fetch(`${API_BASE}/api/test-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${keyInput}` }
      });
      
      const data = await res.json();
      
      if (data.valid) {
        await encryptApiKey(keyInput);
        setApiKey(keyInput);
        loadChats();
        // Models come back with the test-key response
        if (data.models?.length) {
          setModels(data.models);
          if (data.models[0]) {
            setSelectedModel(data.models[0].value);
          }
        } else {
          loadModels(keyInput);
        }
      } else {
        setKeyError(data.error || 'Invalid API key');
      }
    } catch (e) {
      setKeyError('Connection error. Check your network.');
    } finally {
      setCheckingKey(false);
    }
  }

  async function handleLogout() {
    await clearApiKey();
    setApiKey(null);
    setKeyInput('');
    setChats([]);
    setMessages([]);
    setCurrentChatId(null);
    setShowSettings(false);
    setModels([]);
    setSelectedModel('');
  }

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models[0].value);
    }
  }, [models, selectedModel]);

  // File handling
  function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    fileArray.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            setImages(prev => [...prev, e.target!.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) handleFiles([file]);
      }
    }
  }

  // Send message
  async function sendMessage(text: string, attachedImages: string[], modelOverride?: string) {
    if ((!text.trim() && attachedImages.length === 0) || isLoading || !apiKey) return;
    if (!modelOverride && !selectedModel) return;

    let chatId = currentChatId;

    if (!chatId) {
      const chat = await createChat(chatSystemPrompt || undefined);
      setChats(prev => [chat, ...prev]);
      chatId = chat.id;
      setCurrentChatId(chatId);
    }

    const userMessage = await addMessage({
      chatId,
      role: 'user',
      content: text.trim(),
      images: attachedImages.length > 0 ? [...attachedImages] : undefined
    });

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setImages([]);
    setIsLoading(true);
    setStreamingText('');
    setErrorBanner('');

    loadChats();

    abortControllerRef.current = new AbortController();

    try {
      const chat = await getChat(chatId);
      const historyMessages = await getChatMessages(chatId);
      const modelToUse = modelOverride || selectedModel;
      const chatPrompt = chat?.systemPrompt ?? chatSystemPrompt;
      const combinedPrompt = [globalSystemPrompt, chatPrompt]
        .map(prompt => prompt?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n');

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: historyMessages.map(m => ({
            role: m.role,
            content: m.content,
            images: m.images
          })),
          newMessage: {
            text: text.trim(),
            images: attachedImages
          },
          systemPrompt: combinedPrompt || undefined
        }),
        signal: abortControllerRef.current.signal
      });

      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 429) {
          handleQuotaError(errorText, modelToUse, { text: text.trim(), images: attachedImages });
          throw new Error('quota_error');
        }
        throw new Error(errorText);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                if (parsed.error.includes('429') || parsed.error.includes('Quota')) {
                  handleQuotaError(parsed.error, modelToUse, { text: text.trim(), images: attachedImages });
                  throw new Error('quota_error');
                }
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                fullText += parsed.text;
                setStreamingText(fullText);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      if (fullText) {
        const assistantMessage = await addMessage({
          chatId,
          role: 'model',
          content: fullText
        });
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError' && error.message !== 'quota_error') {
        const errorMessage = await addMessage({
          chatId,
          role: 'model',
          content: `Ошибка: ${error.message}`
        });
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      setStreamingText('');
      abortControllerRef.current = null;
    }
  }

  async function handleSend() {
    await sendMessage(input.trim(), images);
  }

  function handleStop() {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    if (streamingText.trim() && currentChatId) {
      addMessage({
        chatId: currentChatId,
        role: 'model',
        content: streamingText
      }).then(message => {
        setMessages(prev => [...prev, message]);
      });
    }
    setStreamingText('');
  }

  function startEdit(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  }

  async function handleSaveEdit() {
    if (!editingMessageId || !currentChatId) return;
    
    // Find the message and delete everything after it
    await deleteMessagesAfter(currentChatId, editingMessageId);
    
    // Reload and resend with edited content
    const updatedMessages = await getChatMessages(currentChatId);
    setMessages(updatedMessages.slice(0, -1)); // Remove the edited message too

    await sendMessage(editingContent, []);
    setEditingMessageId(null);
    setEditingContent('');
  }

  async function handleRetryMessage(messageId: string) {
    if (!currentChatId) return;
    const currentMessages = await getChatMessages(currentChatId);
    const targetIndex = currentMessages.findIndex(m => m.id === messageId);
    if (targetIndex <= 0) return;
    const previousUser = [...currentMessages]
      .slice(0, targetIndex)
      .reverse()
      .find(m => m.role === 'user');
    if (!previousUser) return;

    await deleteMessagesAfter(currentChatId, previousUser.id);
    const refreshed = await getChatMessages(currentChatId);
    setMessages(refreshed);
    await sendMessage(previousUser.content, previousUser.images || []);
  }

  async function handleDeleteMessage(messageId: string) {
    if (!currentChatId) return;
    await deleteMessage(messageId);
    const refreshed = await getChatMessages(currentChatId);
    setMessages(refreshed);
  }

  async function handleExport() {
    if (!currentChatId) return;
    
    const markdown = await exportChat(currentChatId);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${currentChatId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveSystemPrompt() {
    if (currentChatId) {
      await updateChat(currentChatId, { systemPrompt: chatSystemPrompt || undefined });
    }
    if (globalSystemPrompt.trim()) {
      localStorage.setItem(GLOBAL_SYSTEM_PROMPT_KEY, globalSystemPrompt.trim());
    } else {
      localStorage.removeItem(GLOBAL_SYSTEM_PROMPT_KEY);
    }
    setShowSystemPrompt(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function getQuotaBadge(model: Model) {
    const quota = getQuota(model.value);
    if (!quota) {
      return null;
    }
    if (quota.limit === 0) {
      return { text: 'Недоступна (Free tier)', color: 'bg-zinc-300 text-zinc-600' };
    }
    if (quota.limit !== null && quota.remaining !== null) {
      const ratio = quota.limit > 0 ? quota.remaining / quota.limit : 0;
      if (quota.remaining === 0) {
        return { text: `0/${quota.limit} исчерпан`, color: 'bg-red-100 text-red-700' };
      }
      if (ratio <= 0.1) {
        return { text: `${quota.remaining}/${quota.limit} осталось`, color: 'bg-red-100 text-red-700' };
      }
      if (ratio <= 0.5) {
        return { text: `${quota.remaining}/${quota.limit} осталось`, color: 'bg-yellow-100 text-yellow-700' };
      }
      return { text: `${quota.remaining}/${quota.limit} осталось`, color: 'bg-green-100 text-green-700' };
    }
    return null;
  }

  // API Key modal
  if (!apiKey) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-xl border border-zinc-200">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-zinc-900 mb-2">Pollux Chat</h1>
            <p className="text-zinc-500">Введите ключ Google AI, чтобы начать</p>
          </div>

          <div className="space-y-4">
            <div>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitKey()}
                placeholder="AIza..."
                className="w-full bg-zinc-100 text-zinc-900 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 border border-zinc-200"
              />
            </div>

            {keyError && (
              <div className="flex items-center gap-2 text-red-500 text-sm">
                <AlertCircle size={16} />
                {keyError}
              </div>
            )}

            <button
              onClick={handleSubmitKey}
              disabled={checkingKey || !keyInput.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-3 transition"
            >
              {checkingKey ? 'Проверяем...' : 'Начать чат'}
            </button>

            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener"
              className="flex items-center justify-center gap-2 text-blue-500 hover:text-blue-600 text-sm"
            >
              <ExternalLink size={14} />
              Получить бесплатный ключ в Google AI Studio
            </a>
          </div>

          <div className="mt-8 p-4 bg-zinc-50 rounded-lg border border-zinc-200">
            <p className="text-zinc-500 text-xs text-center">
              ⚠️ Ключ шифруется и хранится только в этом браузере.
              Чаты сохраняются локально и будут удалены при очистке данных.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentModel = models.find(m => m.value === selectedModel) || models[0];

  return (
    <div 
      className={`h-screen w-full flex ${theme === 'dark' ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}`}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="fixed inset-0 bg-blue-500/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 text-center shadow-xl">
            <Image size={48} className="mx-auto mb-4 text-blue-500" />
            <p className="text-zinc-900 text-lg">Перетащите изображения сюда</p>
          </div>
        </div>
      )}

      <aside className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 overflow-hidden flex-shrink-0 ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-zinc-50 border-zinc-200'} border-r flex flex-col`}>
        <div className="p-4">
          <button
            onClick={handleNewChat}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-white hover:bg-zinc-100'} border ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'} transition`}
          >
            <Plus size={18} />
            Новый чат
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {chats.map(chat => (
            <div
              key={chat.id}
              onClick={() => selectChat(chat.id)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer mb-1 ${
                currentChatId === chat.id
                  ? theme === 'dark' ? 'bg-zinc-800' : 'bg-white shadow-sm'
                  : theme === 'dark' ? 'hover:bg-zinc-800/60' : 'hover:bg-white'
              }`}
            >
              <MessageSquare size={16} className="flex-shrink-0 opacity-50" />
              <span className="flex-1 truncate text-sm">{chat.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition"
                title="Удалить чат"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className={`p-3 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <p className="text-xs text-zinc-500 text-center">
            История хранится локально
          </p>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className={`flex items-center gap-3 px-6 py-4 border-b ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-200/60'}`}>
            <Menu size={20} />
          </button>
          <div>
            <h1 className="font-semibold text-lg">Pollux Chat</h1>
          </div>
          <div className="flex-1" />
          <div className="relative" ref={modelDropdownRef}>
            <button
              onClick={() => setShowModelDropdown(prev => !prev)}
              className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm border ${
                theme === 'dark'
                  ? 'border-zinc-700 bg-zinc-800 hover:border-blue-400'
                  : 'border-zinc-200 bg-white hover:border-blue-400'
              }`}
            >
              <span className="text-zinc-500">Модель:</span>
              <span className={theme === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}>
                {currentModel?.label || 'Выберите'}
              </span>
            </button>
            {showModelDropdown && (
              <div className={`absolute right-0 top-full mt-2 w-80 rounded-2xl shadow-xl z-50 max-h-96 overflow-y-auto border ${
                theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'
              }`}
              >
                <div className="p-3 border-b border-zinc-200/70 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Модели</span>
                  <button
                    onClick={() => loadModels(apiKey)}
                    className={`p-1 rounded ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100/60'}`}
                  >
                    <RefreshCw size={14} className={loadingModels ? 'animate-spin' : ''} />
                  </button>
                </div>
                {models.map(model => {
                  const badge = getQuotaBadge(model);
                  return (
                    <button
                      key={model.value}
                      onClick={() => { setSelectedModel(model.value); setShowModelDropdown(false); }}
                      className={`w-full text-left px-3 py-3 border-b ${
                        theme === 'dark' ? 'border-zinc-800 hover:bg-zinc-800' : 'border-zinc-100 hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm">{model.label}</div>
                        {badge && (
                          <span className={`text-[10px] px-2 py-1 rounded-full ${badge.color}`}>{badge.text}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{model.description}</div>
                      {model.inputTokens && (
                        <div className="text-[11px] text-zinc-400 mt-1">
                          {(model.inputTokens / 1000).toFixed(0)}K / {(model.outputTokens! / 1000).toFixed(0)}K токенов
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button onClick={() => setShowSystemPrompt(true)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-200/60'}`} title="Системный промпт">
            <Settings size={18} />
          </button>
          <button onClick={handleExport} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-200/60'}`} title="Экспорт">
            <Download size={18} />
          </button>
          <button onClick={toggleTheme} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-zinc-800' : 'hover:bg-zinc-200/60'}`}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={() => setShowSettings(true)} className={`p-2 rounded-full ${theme === 'dark' ? 'hover:bg-zinc-800 text-red-300' : 'hover:bg-zinc-200/60 text-red-500'}`} title="Выйти">
            <ArrowRightLeft size={18} />
          </button>
        </header>

        {errorBanner && (
          <div className="px-6 pt-4">
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              {errorBanner}
            </div>
          </div>
        )}

        {quotaWarningMessage && (
          <div className="px-6 pt-3">
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-700">
              {quotaWarningMessage}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {messages.length === 0 && !streamingText && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-semibold mb-2">Начните диалог</h2>
                <p className="text-zinc-500">Напишите сообщение или перетащите изображение</p>
              </div>
            </div>
          )}

          {messages.map(message => (
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'model' && (
                <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <Bot size={18} />
                </div>
              )}
              <div className={`max-w-3xl rounded-2xl px-4 py-3 shadow-sm ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : theme === 'dark' ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900'
              }`}>
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {message.images.map((img, i) => (
                      <img key={i} src={img} alt="" className="max-h-40 rounded-lg border border-zinc-200" />
                    ))}
                  </div>
                )}

                {editingMessageId === message.id ? (
                  <div>
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="w-full bg-zinc-100 rounded-lg p-2 text-zinc-900 resize-none"
                      rows={4}
                    />
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleSaveEdit} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-500">
                        <Check size={14} /> Сохранить и отправить
                      </button>
                      <button onClick={() => setEditingMessageId(null)} className="text-sm text-zinc-400 hover:text-zinc-600">
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`prose prose-sm max-w-none ${theme === 'dark' || message.role === 'user' ? 'prose-invert' : ''}`}>
                    <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}

                {message.role === 'model' && (
                  <div className="flex justify-end gap-3 mt-3 text-xs text-zinc-500">
                    <button onClick={() => handleRetryMessage(message.id)} className="flex items-center gap-1 hover:text-blue-600">
                      <RotateCcw size={14} /> Повторить
                    </button>
                    <button onClick={() => copyToClipboard(message.content)} className="flex items-center gap-1 hover:text-blue-600">
                      <Copy size={14} /> Копировать
                    </button>
                    <button onClick={() => handleDeleteMessage(message.id)} className="flex items-center gap-1 hover:text-red-500">
                      <Trash2 size={14} /> Удалить
                    </button>
                  </div>
                )}

                {message.role === 'user' && !editingMessageId && (
                  <div className="flex justify-end mt-2 text-xs text-blue-100">
                    <button onClick={() => startEdit(message)} className="flex items-center gap-1 hover:text-white">
                      <Pencil size={12} /> Редактировать
                    </button>
                  </div>
                )}
              </div>
              {message.role === 'user' && (
                <div className="h-9 w-9 rounded-full bg-zinc-200 text-zinc-700 flex items-center justify-center flex-shrink-0">
                  <User size={18} />
                </div>
              )}
            </div>
          ))}

          {streamingText && (
            <div className="flex gap-3">
              <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                <Bot size={18} />
              </div>
              <div className={`max-w-3xl rounded-2xl px-4 py-3 shadow-sm ${theme === 'dark' ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900'}`}>
                <div className={`prose prose-sm max-w-none ${theme === 'dark' ? 'prose-invert' : ''}`}>
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {isLoading && !streamingText && (
            <div className="flex gap-3">
              <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                <Bot size={18} />
              </div>
              <div className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-white'}`}>
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className={`px-6 py-4 border-t ${theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'}`}>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="" className="h-16 rounded-lg border border-zinc-200" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5"
                  >
                    <X size={12} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
              accept="image/*"
              multiple
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`p-2.5 rounded-full border ${theme === 'dark' ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-white'} hover:border-blue-400`}
            >
              <Image size={20} />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Введите сообщение..."
              rows={1}
              className={`flex-1 resize-none rounded-2xl px-4 py-3 outline-none border ${
                theme === 'dark'
                  ? 'bg-zinc-800 border-zinc-700 focus:ring-2 focus:ring-blue-500'
                  : 'bg-white border-zinc-200 focus:ring-2 focus:ring-blue-500'
              }`}
            />

            {isLoading ? (
              <button onClick={handleStop} className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white">
                <Square size={18} />
                Остановить
              </button>
            ) : (
              <>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && images.length === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
                >
                  <Send size={18} />
                  Отправить
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      {showSystemPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-lg rounded-2xl p-6 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-white'}`}>
            <h2 className="text-lg font-semibold mb-4">Системный промпт</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-2">Глобальный промпт (для всех чатов)</label>
                <textarea
                  value={globalSystemPrompt}
                  onChange={(e) => setGlobalSystemPrompt(e.target.value)}
                  placeholder="Например: отвечай кратко и по делу..."
                  rows={4}
                  className={`w-full rounded-lg p-3 resize-none ${theme === 'dark' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-900'}`}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-2">Промпт для текущего чата</label>
                <textarea
                  value={chatSystemPrompt}
                  onChange={(e) => setChatSystemPrompt(e.target.value)}
                  placeholder="Опционально: настройте поведение модели в этом чате..."
                  rows={4}
                  className={`w-full rounded-lg p-3 resize-none ${theme === 'dark' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-900'}`}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowSystemPrompt(false)} className="px-4 py-2 text-zinc-400 hover:text-zinc-600">
                Отмена
              </button>
              <button onClick={handleSaveSystemPrompt} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-white'}`}>
            <h2 className="text-lg font-semibold mb-4">Настройки</h2>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white"
            >
              Выйти и очистить ключ API
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="w-full px-4 py-2 mt-2 text-zinc-400 hover:text-zinc-600"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
