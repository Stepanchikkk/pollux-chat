import Dexie, { type Table } from 'dexie';

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'model';
  content: string;
  images?: string[]; // base64
  timestamp: Date;
}

export interface Chat {
  id: string;
  title: string;
  systemPrompt?: string;
  createdAt: Date;
  updatedAt: Date;
}

class PolluxDatabase extends Dexie {
  chats!: Table<Chat>;
  messages!: Table<ChatMessage>;

  constructor() {
    super('pollux-chat');
    
    this.version(1).stores({
      chats: 'id, updatedAt',
      messages: 'id, chatId, timestamp'
    });
  }
}

export const db = new PolluxDatabase();

// Chat operations
export async function createChat(systemPrompt?: string): Promise<Chat> {
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: 'Новый чат',
    systemPrompt,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await db.chats.add(chat);
  return chat;
}

export async function getAllChats(): Promise<Chat[]> {
  return db.chats.orderBy('updatedAt').reverse().toArray();
}

export async function getChat(id: string): Promise<Chat | undefined> {
  return db.chats.get(id);
}

export async function updateChat(id: string, updates: Partial<Chat>): Promise<void> {
  await db.chats.update(id, { ...updates, updatedAt: new Date() });
}

export async function deleteChat(id: string): Promise<void> {
  await db.transaction('rw', [db.chats, db.messages], async () => {
    await db.messages.where('chatId').equals(id).delete();
    await db.chats.delete(id);
  });
}

// Message operations
export async function addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
  const fullMessage: ChatMessage = {
    ...message,
    id: crypto.randomUUID(),
    timestamp: new Date()
  };
  await db.messages.add(fullMessage);
  
  // Update chat title from first user message
  const messageCount = await db.messages.where('chatId').equals(message.chatId).count();
  if (messageCount === 1 && message.role === 'user') {
    const title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    await updateChat(message.chatId, { title: title || 'Новый чат' });
  } else {
    await updateChat(message.chatId, {});
  }
  
  return fullMessage;
}

export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  return db.messages.where('chatId').equals(chatId).sortBy('timestamp');
}

export async function updateMessage(id: string, content: string): Promise<void> {
  await db.messages.update(id, { content });
}

export async function deleteMessage(id: string): Promise<void> {
  await db.messages.delete(id);
}

export async function deleteMessagesAfter(chatId: string, messageId: string): Promise<void> {
  const messages = await getChatMessages(chatId);
  const index = messages.findIndex(m => m.id === messageId);
  if (index >= 0) {
    const idsToDelete = messages.slice(index).map(m => m.id);
    await db.messages.bulkDelete(idsToDelete);
  }
}

// Export chat
export async function exportChat(chatId: string): Promise<string> {
  const chat = await getChat(chatId);
  const messages = await getChatMessages(chatId);
  
  if (!chat) return '';
  
  let markdown = `# ${chat.title}\n\n`;
  markdown += `*Экспортировано: ${new Date().toLocaleString()}*\n\n`;
  
  if (chat.systemPrompt) {
    markdown += `## Системный промпт\n\n${chat.systemPrompt}\n\n`;
  }
  
  markdown += `---\n\n`;
  
  for (const msg of messages) {
    const role = msg.role === 'user' ? '**Вы**' : '**Ассистент**';
    markdown += `${role} (${new Date(msg.timestamp).toLocaleTimeString()})\n\n`;
    markdown += `${msg.content}\n\n`;
    if (msg.images?.length) {
      markdown += `*[${msg.images.length} image(s) attached]*\n\n`;
    }
    markdown += `---\n\n`;
  }
  
  return markdown;
}

// Clear all data
export async function clearAllData(): Promise<void> {
  await db.delete();
  await db.open();
}
