import fs from 'node:fs';
import path from 'node:path';

const isProduction = process.env.NODE_ENV === "production";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const DATA_DIR = process.env.DATA_DIR;

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVELS[LOG_LEVEL.toLowerCase()] ?? LEVELS.info;
const logFile = DATA_DIR ? path.join(DATA_DIR, 'app.log') : null;

function writeToFile(level, message, data) {
  if (!logFile) return;
  try {
    const entry = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      data
    });
    fs.appendFileSync(logFile, entry + '\n');
  } catch (err) {
    // Fallback if file writing fails
    console.error('Failed to write to log file:', err.message);
  }
}

/**
 * Simple object sanitizer to remove potentially sensitive fields
 * @param {Object} obj The object to sanitize
 * @param {Array<string>} sensitiveFields Fields to remove or mask
 * @returns {Object} Sanitized object
 */
export function sanitize(obj, sensitiveFields = ["password", "token", "auth", "userId", "email", "password_hash", "encryption_master_key"]) {
  if (!obj || typeof obj !== "object" || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item, sensitiveFields));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitize(value, sensitiveFields);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

const logger = {
  debug: (message, ...args) => {
    if (currentLevel <= LEVELS.debug) {
      const sanitizedArgs = args.length > 0 ? sanitize(args) : undefined;
      console.debug(`[DEBUG] ${message}`, ...args.map(a => typeof a === 'object' ? sanitize(a) : a));
      if (isProduction) writeToFile('debug', message, sanitizedArgs);
    }
  },
  info: (message, ...args) => {
    if (currentLevel <= LEVELS.info) {
      const sanitizedArgs = args.length > 0 ? sanitize(args) : undefined;
      if (isProduction) {
        // Structured logging for production
        console.log(JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), data: sanitizedArgs }));
        writeToFile('info', message, sanitizedArgs);
      } else {
        console.log(`[INFO] ${message}`, ...args.map(a => typeof a === 'object' ? sanitize(a) : a));
      }
    }
  },
  warn: (message, ...args) => {
    if (currentLevel <= LEVELS.warn) {
      const sanitizedArgs = args.length > 0 ? sanitize(args) : undefined;
      if (isProduction) {
        console.warn(JSON.stringify({ level: 'warn', message, timestamp: new Date().toISOString(), data: sanitizedArgs }));
        writeToFile('warn', message, sanitizedArgs);
      } else {
        console.warn(`[WARN] ${message}`, ...args.map(a => typeof a === 'object' ? sanitize(a) : a));
      }
    }
  },
  error: (message, ...args) => {
    if (currentLevel <= LEVELS.error) {
      const errorData = args[0] instanceof Error ? { message: args[0].message, stack: args[0].stack } : args[0];
      const additionalData = args.length > 1 ? sanitize(args.slice(1)) : undefined;
      
      if (isProduction) {
        console.error(JSON.stringify({ 
          level: 'error', 
          message, 
          timestamp: new Date().toISOString(), 
          error: errorData, 
          data: additionalData 
        }));
        writeToFile('error', message, { error: errorData, data: additionalData });
      } else {
        console.error(`[ERROR] ${message}`, ...args);
      }
    }
  },
};

export default logger;
