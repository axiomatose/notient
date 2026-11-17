import argon2 from 'argon2';
import crypto from 'crypto';
import logger from './logger.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};

// Master key from environment - should be 32 bytes for AES-256
// Defaults to a stable string in dev to prevent decryption errors on restart
// We match the logic in config.js for consistency
const MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY;
if (!MASTER_KEY || MASTER_KEY.length < 32) {
  throw new Error('ENCRYPTION_MASTER_KEY must be set and be at least 32 characters in production');
}
/**
 * Derive a per-user encryption key using Argon2
 * @param {string} userId - The user's ID
 * @returns {Promise<Buffer>} 32-byte encryption key
 */
export async function deriveEncryptionKey(userId) {
  // Use userId + master key as the password for key derivation
  const password = `${userId}:${MASTER_KEY}`;
  const salt = Buffer.from(userId.padEnd(16, '0').substring(0, 16)); // 16-byte salt
  
    logger.debug(`[Encryption] Deriving key for userId: ${userId} (MasterKey prefix: ${MASTER_KEY.substring(0, 4)}...)`);
  
  // Use Argon2 as a KDF - hash the password, then use first 32 bytes as key
  const hash = await argon2.hash(password, {
    ...ARGON2_OPTIONS,
    salt,
    hashLength: 32,
  });
  
  // Argon2 hash includes metadata, we need to extract just the hash part
  // The hash is base64 encoded in the format $argon2id$v=19$m=65536,t=3,p=1$...$...
  const parts = hash.split('$');
  const rawHash = Buffer.from(parts[parts.length - 1], 'base64');
  
  return rawHash.subarray(0, 32);
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {string} userId - User ID for key derivation
 * @returns {Promise<string>} Base64-encoded encrypted data with IV and auth tag
 */
export async function encrypt(plaintext, userId) {
  const key = await deriveEncryptionKey(userId);
  const iv = crypto.randomBytes(12); // GCM recommends 12-byte IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV + authTag + encrypted data
  const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')]);
  return combined.toString('base64');
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} ciphertext - Base64-encoded encrypted data
 * @param {string} userId - User ID for key derivation
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decrypt(ciphertext, userId) {
  const key = await deriveEncryptionKey(userId);
  const combined = Buffer.from(ciphertext, 'base64');
  
    logger.debug(`[Encryption] Decrypting string starting with: ${ciphertext.substring(0, 10)}... (Length: ${ciphertext.length}, Combined: ${combined.length})`);

  // Extract IV (12 bytes), authTag (16 bytes), and encrypted data
  // Total must be at least 28 bytes (IV + Tag)
  if (combined.length < 28) {
      logger.warn(`[Encryption] Combined length ${combined.length} is less than 28. Ciphertext prefix: ${ciphertext.substring(0, 10)}...`);
    throw new Error('Ciphertext too short to be valid encrypted data');
  }
  
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(12, 28);
  const encrypted = combined.subarray(28);
  
    logger.debug(`[Encryption] Components: IV=${iv.length}, Tag=${authTag.length}, Data=${encrypted.length}`);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

/**
 * Encrypt an object (converts to JSON first)
 * @param {Object} obj - Object to encrypt
 * @param {string} userId - User ID for key derivation
 * @returns {Promise<string>} Base64-encoded encrypted data
 */
export async function encryptObject(obj, userId) {
  return encrypt(JSON.stringify(obj), userId);
}

/**
 * Decrypt to an object
 * @param {string} ciphertext - Base64-encoded encrypted data
 * @param {string} userId - User ID for key derivation
 * @returns {Promise<Object>} Decrypted object
 */
export async function decryptObject(ciphertext, userId) {
  const plaintext = await decrypt(ciphertext, userId);
  return JSON.parse(plaintext);
}
