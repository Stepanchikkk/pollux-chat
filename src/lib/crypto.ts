/**
 * Encrypt/decrypt API key in localStorage using Web Crypto API
 * Uses AES-GCM with a derived key from a device-specific fingerprint
 */

const SALT = 'pollux-chat-v1';
const KEY_STORAGE = 'pollux_encrypted_key';
const IV_STORAGE = 'pollux_iv';

// Generate a fingerprint based on browser/device characteristics
async function getFingerprint(): Promise<string> {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset().toString(),
    navigator.hardwareConcurrency?.toString() || '4',
  ];
  return components.join('|');
}

// Derive encryption key from fingerprint
async function deriveKey(fingerprint: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(fingerprint),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt API key
export async function encryptApiKey(apiKey: string): Promise<void> {
  try {
    const fingerprint = await getFingerprint();
    const key = await deriveKey(fingerprint);
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(apiKey)
    );
    
    // Store as base64
    localStorage.setItem(KEY_STORAGE, btoa(String.fromCharCode(...new Uint8Array(encrypted))));
    localStorage.setItem(IV_STORAGE, btoa(String.fromCharCode(...iv)));
  } catch (error) {
    console.error('Encryption failed:', error);
    // Fallback: store plain (better than nothing)
    localStorage.setItem('pollux_api_key_plain', apiKey);
  }
}

// Decrypt API key
export async function decryptApiKey(): Promise<string | null> {
  try {
    const encryptedB64 = localStorage.getItem(KEY_STORAGE);
    const ivB64 = localStorage.getItem(IV_STORAGE);
    
    if (!encryptedB64 || !ivB64) {
      // Check for plain fallback
      return localStorage.getItem('pollux_api_key_plain');
    }
    
    const fingerprint = await getFingerprint();
    const key = await deriveKey(fingerprint);
    
    const encrypted = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return localStorage.getItem('pollux_api_key_plain');
  }
}

// Clear stored key
export async function clearApiKey(): Promise<void> {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(IV_STORAGE);
  localStorage.removeItem('pollux_api_key_plain');
}

// Check if key exists
export function hasStoredKey(): boolean {
  return !!(
    localStorage.getItem(KEY_STORAGE) || 
    localStorage.getItem('pollux_api_key_plain')
  );
}
