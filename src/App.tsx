import { useState, useEffect, useRef } from 'react';
import { 
  Send, Square, RotateCcw, Pencil, Download, Trash2, Plus, 
  Settings, Moon, Sun, Image, X, Check, MessageSquare,
  ChevronDown, RefreshCw, Menu, AlertCircle, Copy, ExternalLink
} from 'lucide-react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { useTheme } from './hooks/useTheme';
import { encryptApiKey, decryptApiKey, clearApiKey, hasStoredKey } from './lib/crypto';
import { 
  createChat, getAllChats, getChat, updateChat, deleteChat,
  addMessage, getChatMessages, deleteMessagesAfter, exportChat,
  type Chat, type ChatMessage 
} from './lib/db';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface Model {
  value: string;
  label: string;
  description: string;
  inputTokens?: number;
  outputTokens?: number;
}

const FALLBACK_MODELS: Model[] = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Fast and efficient' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Most capable' },
];

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
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  
  // System prompt
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  
  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize
  useEffect(() => {
    initializeApp();
  }, []);

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
      setSystemPrompt(chat.systemPrompt);
    } else {
      setSystemPrompt('');
    }
  }

  async function handleNewChat() {
    const chat = await createChat(systemPrompt || undefined);
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
        if (data.models[0]) {
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
        loadModels(keyInput);
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

  // Highlight code blocks
  useEffect(() => {
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
  }, [messages, streamingText]);

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
  async function handleSend() {
    if ((!input.trim() && images.length === 0) || isLoading || !apiKey) return;
    
    let chatId = currentChatId;
    
    // Create new chat if none exists
    if (!chatId) {
      const chat = await createChat(systemPrompt || undefined);
      setChats(prev => [chat, ...prev]);
      chatId = chat.id;
      setCurrentChatId(chatId);
    }
    
    // Save user message
    const userMessage = await addMessage({
      chatId,
      role: 'user',
      content: input.trim(),
      images: images.length > 0 ? [...images] : undefined
    });
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setImages([]);
    setIsLoading(true);
    setStreamingText('');
    
    // Refresh chat list (title may have updated)
    loadChats();
    
    // Setup abort controller
    abortControllerRef.current = new AbortController();
    
    try {
      const chat = await getChat(chatId);
      
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            images: m.images
          })),
          newMessage: {
            text: input.trim(),
            images
          },
          systemPrompt: chat?.systemPrompt || systemPrompt
        }),
        signal: abortControllerRef.current.signal
      });
      
      if (!res.ok) {
        throw new Error(await res.text());
      }
      
      // Read stream
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
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                fullText += parsed.text;
                setStreamingText(fullText);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
      
      // Save assistant message
      if (fullText) {
        const assistantMessage = await addMessage({
          chatId,
          role: 'model',
          content: fullText
        });
        setMessages(prev => [...prev, assistantMessage]);
      }
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errorMessage = await addMessage({
          chatId,
          role: 'model',
          content: `Error: ${error.message}`
        });
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      setStreamingText('');
      abortControllerRef.current = null;
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    setStreamingText('');
  }

  async function handleRegenerate() {
    if (messages.length < 2) return;
    
    // Find last user message
    const lastUserIndex = messages.map(m => m.role).lastIndexOf('user');
    if (lastUserIndex === -1) return;
    
    const lastUserMessage = messages[lastUserIndex];
    
    // Delete messages from last user message onwards
    await deleteMessagesAfter(currentChatId!, lastUserMessage.id);
    
    // Reload messages
    const updatedMessages = await getChatMessages(currentChatId!);
    setMessages(updatedMessages);
    
    // Resend
    setInput(lastUserMessage.content);
    setImages(lastUserMessage.images || []);
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
    
    setInput(editingContent);
    setEditingMessageId(null);
    setEditingContent('');
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
      await updateChat(currentChatId, { systemPrompt });
    }
    setShowSystemPrompt(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  // Render markdown with code highlighting
  function renderMarkdown(text: string) {
    let html = text
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        const language = lang || 'plaintext';
        return `<pre><code class="language-${language}">${escapeHtml(code.trim())}</code></pre>`;
      })
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blue-400 hover:underline">$1</a>')
      // Line breaks
      .replace(/\n/g, '<br>');
    
    return html;
  }

  function escapeHtml(text: string) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // API Key modal
  if (!apiKey) {
    return (
      <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
        <div className="bg-zinc-800 rounded-2xl p-8 max-w-md w-full shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Pollux Chat</h1>
            <p className="text-zinc-400">Enter your Google AI API key to start</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitKey()}
                placeholder="AIza..."
                className="w-full bg-zinc-700 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            {keyError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={16} />
                {keyError}
              </div>
            )}
            
            <button
              onClick={handleSubmitKey}
              disabled={checkingKey || !keyInput.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-3 transition"
            >
              {checkingKey ? 'Checking...' : 'Start Chatting'}
            </button>
            
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener"
              className="flex items-center justify-center gap-2 text-blue-400 hover:text-blue-300 text-sm"
            >
              <ExternalLink size={14} />
              Get free API key from Google AI Studio
            </a>
          </div>
          
          <div className="mt-8 p-4 bg-zinc-700/50 rounded-lg">
            <p className="text-zinc-400 text-xs text-center">
              ⚠️ Your API key is encrypted and stored only in this browser.
              Chats are saved locally and will be lost if you clear browser data.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentModel = models.find(m => m.value === selectedModel) || models[0];

  return (
    <div 
      className={`h-screen flex ${theme === 'dark' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'}`}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 bg-blue-500/20 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-zinc-800 rounded-2xl p-8 text-center">
            <Image size={48} className="mx-auto mb-4 text-blue-400" />
            <p className="text-white text-lg">Drop images here</p>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 overflow-hidden flex-shrink-0 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'} flex flex-col`}>
        <div className="p-3">
          <button
            onClick={handleNewChat}
            className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-white hover:bg-zinc-200'} transition`}
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-2">
          {chats.map(chat => (
            <div
              key={chat.id}
              onClick={() => selectChat(chat.id)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer mb-1 ${
                currentChatId === chat.id
                  ? theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-200'
                  : theme === 'dark' ? 'hover:bg-zinc-700/50' : 'hover:bg-zinc-200/50'
              }`}
            >
              <MessageSquare size={16} className="flex-shrink-0 opacity-50" />
              <span className="flex-1 truncate text-sm">{chat.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        
        <div className={`p-3 border-t ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <p className="text-xs text-zinc-500 text-center">
            Chats stored locally
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className={`flex items-center gap-3 px-4 py-2 border-b ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-zinc-700/50 rounded-lg">
            <Menu size={20} />
          </button>
          
          <h1 className="font-semibold">Pollux Chat</h1>
          
          <div className="flex-1" />
          
          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-zinc-100 hover:bg-zinc-200'}`}
            >
              {loadingModels ? 'Loading...' : currentModel?.label || 'Select model'}
              <ChevronDown size={16} />
            </button>
            
            {showModelDropdown && (
              <div className={`absolute right-0 top-full mt-1 w-80 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto ${theme === 'dark' ? 'bg-zinc-800 border border-zinc-700' : 'bg-white border border-zinc-200'}`}>
                <div className="p-2 border-b border-zinc-700 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Models</span>
                  <button onClick={() => loadModels(apiKey)} className="p-1 hover:bg-zinc-700 rounded">
                    <RefreshCw size={14} className={loadingModels ? 'animate-spin' : ''} />
                  </button>
                </div>
                {models.map(model => (
                  <button
                    key={model.value}
                    onClick={() => { setSelectedModel(model.value); setShowModelDropdown(false); }}
                    className={`w-full text-left px-3 py-2 hover:bg-zinc-700/50 ${selectedModel === model.value ? 'bg-zinc-700' : ''}`}
                  >
                    <div className="font-medium text-sm">{model.label}</div>
                    <div className="text-xs text-zinc-400 truncate">{model.description}</div>
                    {model.inputTokens && (
                      <div className="text-xs text-zinc-500 mt-1">
                        {(model.inputTokens / 1000).toFixed(0)}K / {(model.outputTokens! / 1000).toFixed(0)}K tokens
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <button onClick={() => setShowSystemPrompt(true)} className="p-2 hover:bg-zinc-700/50 rounded-lg" title="System Prompt">
            <Settings size={18} />
          </button>
          
          <button onClick={handleExport} className="p-2 hover:bg-zinc-700/50 rounded-lg" title="Export Chat">
            <Download size={18} />
          </button>
          
          <button onClick={toggleTheme} className="p-2 hover:bg-zinc-700/50 rounded-lg">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          
          <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-zinc-700/50 rounded-lg text-red-400" title="Settings">
            <X size={18} />
          </button>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && !streamingText && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-semibold mb-2">Start a conversation</h2>
                <p className="text-zinc-500">Type a message or drop an image</p>
              </div>
            </div>
          )}
          
          {messages.map(message => (
            <div key={message.id} className={`mb-4 ${message.role === 'user' ? 'flex justify-end' : ''}`}>
              <div className={`max-w-3xl rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'
              }`}>
                {/* Images */}
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {message.images.map((img, i) => (
                      <img key={i} src={img} alt="" className="max-h-40 rounded-lg" />
                    ))}
                  </div>
                )}
                
                {/* Content */}
                {editingMessageId === message.id ? (
                  <div>
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="w-full bg-zinc-700 rounded-lg p-2 text-white resize-none"
                      rows={4}
                    />
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleSaveEdit} className="flex items-center gap-1 text-sm text-green-400 hover:text-green-300">
                        <Check size={14} /> Save & Resend
                      </button>
                      <button onClick={() => setEditingMessageId(null)} className="text-sm text-zinc-400 hover:text-white">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div 
                    className="prose prose-invert max-w-none text-sm"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                  />
                )}
                
                {/* Actions */}
                {message.role === 'model' && !editingMessageId && (
                  <div className="flex gap-2 mt-2 opacity-0 hover:opacity-100 transition">
                    <button onClick={() => copyToClipboard(message.content)} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1">
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                )}
                {message.role === 'user' && !editingMessageId && (
                  <div className="flex gap-2 mt-2 opacity-0 hover:opacity-100 transition">
                    <button onClick={() => startEdit(message)} className="text-xs text-blue-200 hover:text-white flex items-center gap-1">
                      <Pencil size={12} /> Edit
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {/* Streaming */}
          {streamingText && (
            <div className="mb-4">
              <div className={`max-w-3xl rounded-2xl px-4 py-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                <div 
                  className="prose prose-invert max-w-none text-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }}
                />
              </div>
            </div>
          )}
          
          {/* Loading */}
          {isLoading && !streamingText && (
            <div className="mb-4">
              <div className={`inline-block rounded-2xl px-4 py-3 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className={`p-4 border-t ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
          {/* Image previews */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="" className="h-16 rounded-lg" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex items-end gap-2">
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
              className={`p-2.5 rounded-lg ${theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-zinc-100 hover:bg-zinc-200'}`}
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
              placeholder="Message..."
              rows={1}
              className={`flex-1 resize-none rounded-lg px-4 py-2.5 outline-none ${
                theme === 'dark' 
                  ? 'bg-zinc-700 focus:ring-2 focus:ring-blue-500' 
                  : 'bg-zinc-100 focus:ring-2 focus:ring-blue-500'
              }`}
            />
            
            {isLoading ? (
              <button onClick={handleStop} className="p-2.5 bg-red-600 hover:bg-red-700 rounded-lg">
                <Square size={20} />
              </button>
            ) : (
              <>
                {messages.length >= 2 && (
                  <button onClick={handleRegenerate} className={`p-2.5 rounded-lg ${theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-zinc-100 hover:bg-zinc-200'}`}>
                    <RotateCcw size={20} />
                  </button>
                )}
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && images.length === 0}
                  className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
                >
                  <Send size={20} />
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      {/* System Prompt Modal */}
      {showSystemPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-lg rounded-2xl p-6 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-white'}`}>
            <h2 className="text-lg font-semibold mb-4">System Prompt</h2>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional: Set AI behavior..."
              rows={6}
              className={`w-full rounded-lg p-3 resize-none ${theme === 'dark' ? 'bg-zinc-700' : 'bg-zinc-100'}`}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowSystemPrompt(false)} className="px-4 py-2 text-zinc-400 hover:text-white">
                Cancel
              </button>
              <button onClick={handleSaveSystemPrompt} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Logout) */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${theme === 'dark' ? 'bg-zinc-800' : 'bg-white'}`}>
            <h2 className="text-lg font-semibold mb-4">Settings</h2>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white"
            >
              Logout & Clear API Key
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="w-full px-4 py-2 mt-2 text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
