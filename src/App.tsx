import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Sun,
  Moon,
  X,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  ChevronDown,
  Zap,
  AlertCircle,
  ImagePlus,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────
interface Model {
  value: string;
  label: string;
  description: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  timestamp: Date;
}

type Theme = 'light' | 'dark';

// ─── Constants ─────────────────────────────────────────────
const FALLBACK_MODELS: Model[] = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Fast and capable' }
];

const MODELS_CACHE_KEY = 'gemini-models';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// ─── Helpers ───────────────────────────────────────────────
function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(count % 1000000 === 0 ? 0 : 1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
  return count.toString();
}

function renderMarkdown(text: string): string {
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-black/20 rounded-lg p-3 my-2 overflow-x-auto text-xs"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-black/20 px-1.5 py-0.5 rounded text-xs">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-lg mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-bold text-xl mt-3 mb-1">$1</h1>')
    .replace(/^\d+\.\s(.+)$/gm, '<div class="ml-4 my-0.5">• $1</div>')
    .replace(/^[-*]\s(.+)$/gm, '<div class="ml-4 my-0.5">• $1</div>')
    .replace(/\n/g, '<br/>');
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return { theme, toggle: () => setTheme(t => t === 'light' ? 'dark' : 'light') };
}

// ─── App ───────────────────────────────────────────────────
export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  // State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Models
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Refs
  const messagesEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);

  // ── Load models ──────────────────────────────────────────
  const loadModels = useCallback(async (force = false) => {
    setIsLoadingModels(true);
    setModelsError(null);

    if (!force) {
      try {
        const cached = localStorage.getItem(MODELS_CACHE_KEY);
        if (cached) {
          const { models: m, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION && m?.length > 0) {
            setModels(m);
            setSelectedModel(m[0]?.value || 'gemini-2.0-flash');
            setIsLoadingModels(false);
            return;
          }
        }
      } catch { /* ignore */ }
    }

    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.models?.length > 0) {
        setModels(data.models);
        setSelectedModel(data.models[0]?.value || 'gemini-2.0-flash');
        localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify({ models: data.models, timestamp: Date.now() }));
        if (data.fallback) setModelsError('Offline list');
      }
    } catch {
      setModelsError('Failed to load');
      setModels(FALLBACK_MODELS);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  // ── Close dropdown on click outside ──────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdown.current && !dropdown.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Auto-scroll ──────────────────────────────────────────
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Auto-resize textarea ─────────────────────────────────
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = Math.min(textarea.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // ── Image handling ───────────────────────────────────────
  const addImages = useCallback((files: File[]) => {
    files.filter(f => f.type.startsWith('image/')).slice(0, 4 - images.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImages(prev => prev.length >= 4 ? prev : [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  }, [images.length]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) addImages(files);
  };

  // ── Drag & drop ──────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length > 0) addImages(Array.from(e.dataTransfer.files));
  }, [addImages]);

  // ── Send message ─────────────────────────────────────────
  const send = async () => {
    if (!input.trim() && images.length === 0) return;
    if (isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      images: images.length > 0 ? [...images] : undefined,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setImages([]);
    setIsLoading(true);

    if (textarea.current) textarea.current.style.height = 'auto';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          newMessage: { text: userMessage.content, images: userMessage.images || [] }
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        timestamp: new Date()
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Request failed'}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const copy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const currentModel = models.find(m => m.value === selectedModel);

  // ─── Render ──────────────────────────────────────────────
  return (
    <div
      className={`min-h-screen h-screen flex flex-col relative ${isDark ? 'bg-[#1a1a1a] text-gray-100' : 'bg-white text-gray-900'}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-500/20 backdrop-blur-sm">
          <div className={`flex flex-col items-center gap-4 p-10 rounded-3xl border-2 border-dashed border-blue-400 ${isDark ? 'bg-[#1a1a1a]/90' : 'bg-white/90'}`}>
            <ImagePlus className="w-16 h-16 text-blue-400" />
            <p className="text-xl font-medium">Drop images here</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className={`flex-shrink-0 h-12 flex items-center justify-between px-4 border-b ${isDark ? 'bg-[#1e1e1e] border-white/10' : 'bg-white border-gray-200'}`}>
        <span className="font-semibold">Gemini</span>

        {/* Model dropdown */}
        <div className="relative" ref={dropdown}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            disabled={isLoadingModels}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isDark ? 'hover:bg-white/10 border border-white/10' : 'hover:bg-gray-100 border border-gray-200'} ${isLoadingModels ? 'opacity-50' : ''}`}
          >
            {isLoadingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-yellow-500" />}
            <span className="hidden sm:inline max-w-[180px] truncate">{currentModel?.label || 'Model'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showDropdown && !isLoadingModels && (
            <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 max-h-80 overflow-y-auto rounded-xl shadow-2xl border z-50 ${isDark ? 'bg-[#252525] border-white/10' : 'bg-white border-gray-200'}`}>
              <div className={`sticky top-0 flex items-center justify-between px-3 py-2 border-b text-xs opacity-50 ${isDark ? 'bg-[#252525] border-white/10' : 'bg-white border-gray-100'}`}>
                <span>{models.length} models</span>
                <button onClick={(e) => { e.stopPropagation(); loadModels(true); }} className="p-1 rounded hover:opacity-100">
                  <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {modelsError && (
                <div className="px-3 py-1.5 text-xs text-yellow-500 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3" />{modelsError}
                </div>
              )}

              {models.map((m) => (
                <button
                  key={m.value}
                  onClick={() => { setSelectedModel(m.value); setShowDropdown(false); }}
                  className={`w-full px-3 py-2 text-left ${m.value === selectedModel ? (isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-600') : (isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50')}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      {m.label}
                      {m.value.includes('flash') && <Zap className="w-3 h-3 text-yellow-500" />}
                    </span>
                    {m.inputTokens && m.outputTokens && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
                        {formatTokens(m.inputTokens)}/{formatTokens(m.outputTokens)}
                      </span>
                    )}
                  </div>
                  {m.description && <p className="text-xs opacity-40 mt-0.5 truncate">{m.description}</p>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={toggleTheme} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <p className={`text-2xl font-medium ${isDark ? 'text-white/20' : 'text-gray-200'}`}>Gemini</p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`relative group max-w-[88%] rounded-2xl px-4 py-2.5 ${msg.role === 'user' ? (isDark ? 'bg-blue-600' : 'bg-blue-500 text-white') : (isDark ? 'bg-[#252525]' : 'bg-gray-100')}`}>
                    {msg.images && msg.images.length > 0 && (
                      <div className={`flex flex-wrap gap-1.5 ${msg.content ? 'mb-2' : ''}`}>
                        {msg.images.map((img, i) => (
                          <img key={i} src={img} alt="" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                    )}
                    {msg.role === 'assistant' && msg.content && (
                      <button
                        onClick={() => copy(msg.id, msg.content)}
                        className={`absolute -bottom-6 left-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-xs flex items-center gap-1 ${isDark ? 'text-white/40 hover:text-white/70' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {copiedId === msg.id ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className={`rounded-2xl px-4 py-3 ${isDark ? 'bg-[#252525]' : 'bg-gray-100'}`}>
                    <div className="flex gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-30 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-30 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-30 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEnd} />
            </div>
          )}
        </div>
      </main>

      {/* Input */}
      <footer className={`flex-shrink-0 p-3 ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
        <div className="max-w-2xl mx-auto">
          {images.length > 0 && (
            <div className="flex gap-2 mb-2 px-2">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img} alt="" className="w-14 h-14 rounded-lg object-cover" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={`flex items-end gap-1.5 rounded-2xl px-3 py-2 border ${isDark ? 'bg-[#252525] border-white/10 focus-within:border-white/20' : 'bg-gray-50 border-gray-200 focus-within:border-gray-400'}`}>
            <button
              onClick={() => fileInput.current?.click()}
              disabled={images.length >= 4}
              className={`p-1.5 rounded-lg flex-shrink-0 ${images.length >= 4 ? 'opacity-20' : (isDark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-200 text-gray-500')}`}
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => { if (e.target.files) addImages(Array.from(e.target.files)); e.target.value = ''; }}
              className="hidden"
            />

            <textarea
              ref={textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message Gemini..."
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed max-h-[200px] py-1.5"
            />

            <button
              onClick={send}
              disabled={isLoading || (!input.trim() && images.length === 0)}
              className={`p-1.5 rounded-lg flex-shrink-0 ${isLoading || (!input.trim() && images.length === 0) ? 'opacity-20' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
