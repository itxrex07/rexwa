const logger = require('./logger');
const config = require('../config');
const rateLimiter = require('./rate-limiter');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

class UserExecutionContext {
    constructor(userId, bot) {
        this.userId = userId;
        this.bot = bot;
        this.workingDir = path.join(process.cwd(), 'temp', userId);
        this.isActive = false;
        this.startTime = Date.now();
        this.cleanup = [];
        this.abortController = new AbortController();
    }

    async initialize() {
        await fs.ensureDir(this.workingDir);
        this.isActive = true;
    }

    async destroy() {
        this.isActive = false;
        this.abortController.abort();
        
        // Execute cleanup functions
        for (const cleanupFn of this.cleanup) {
            try {
                await cleanupFn();
            } catch (error) {
                logger.warn(`Cleanup error for user ${this.userId}:`, error.message);
            }
        }

        // Remove working directory
        try {
            await fs.remove(this.workingDir);
        } catch (error) {
            logger.warn(`Failed to remove working directory for ${this.userId}:`, error.message);
        }
    }

    addCleanup(fn) {
        this.cleanup.push(fn);
    }

    getWorkingPath(filename) {
        return path.join(this.workingDir, filename);
    }

    isExpired(maxAge = 300000) { // 5 minutes default
        return Date.now() - this.startTime > maxAge;
    }
}

class ConcurrencyManager {
    constructor(maxConcurrent = 5) {
        this.maxConcurrent = maxConcurrent;
        this.activeExecutions = new Map(); // userId -> UserExecutionContext
        this.pendingQueue = [];
        this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
    }

    async executeWithIsolation(userId, commandFn, messageContext) {
        return new Promise((resolve, reject) => {
            const execution = {
                userId,
                commandFn,
                messageContext,
                resolve,
                reject,
                timestamp: Date.now()
            };

            if (this.activeExecutions.size < this.maxConcurrent) {
                this.startExecution(execution);
            } else {
                this.pendingQueue.push(execution);
                logger.info(`⏳ User ${userId} queued (${this.pendingQueue.length} pending)`);
            }
        });
    }

    async startExecution(execution) {
        const { userId, commandFn, messageContext, resolve, reject } = execution;
        
        let context = this.activeExecutions.get(userId);
        
        // Create new context if doesn't exist or expired
        if (!context || context.isExpired() || !context.isActive) {
            if (context) {
                await context.destroy();
            }
            context = new UserExecutionContext(userId, messageContext.bot);
            await context.initialize();
            this.activeExecutions.set(userId, context);
        }

        try {
            logger.info(`🚀 Executing command for user ${userId} (${this.activeExecutions.size} active)`);
            
            const result = await Promise.race([
                commandFn(context, messageContext),
                this.timeoutPromise(30000) // 30 second timeout
            ]);
            
            resolve(result);
        } catch (error) {
            logger.error(`❌ Execution failed for user ${userId}:`, error.message);
            reject(error);
        } finally {
            // Don't destroy context immediately - reuse for subsequent commands
            // It will be cleaned up by the cleanup interval
            this.processNext();
        }
    }

    processNext() {
        if (this.pendingQueue.length > 0 && this.activeExecutions.size < this.maxConcurrent) {
            const next = this.pendingQueue.shift();
            this.startExecution(next);
        }
    }

    async cleanupExpired() {
        const expiredUsers = [];
        
        for (const [userId, context] of this.activeExecutions) {
            if (context.isExpired()) {
                expiredUsers.push(userId);
            }
        }

        for (const userId of expiredUsers) {
            const context = this.activeExecutions.get(userId);
            await context.destroy();
            this.activeExecutions.delete(userId);
            logger.debug(`🧹 Cleaned up expired context for user ${userId}`);
        }
    }

    timeoutPromise(ms) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Command execution timeout')), ms);
        });
    }

    async shutdown() {
        clearInterval(this.cleanupInterval);
        
        for (const [userId, context] of this.activeExecutions) {
            await context.destroy();
        }
        
        this.activeExecutions.clear();
        this.pendingQueue.length = 0;
    }
}

class MessageHandler {
    constructor(bot) {
        this.bot = bot;
        this.commandHandlers = new Map();
        this.messageHooks = new Map();
        this.concurrencyManager = new ConcurrencyManager(5);
        this.messageCache = new Map(); // Store recent messages for better retrieval
        
        // Enhanced message storage for multi-user scenarios
        this.setupMessageCaching();
        
        // Cleanup interval for message cache
        setInterval(() => this.cleanupMessageCache(), 300000); // 5 minutes
    }

    setupMessageCaching() {
        // Cache messages as they arrive for better retrieval
        if (this.bot.sock) {
            const originalEvProcess = this.bot.sock.ev.process.bind(this.bot.sock.ev);
            this.bot.sock.ev.process = async (events) => {
                if (events['messages.upsert']) {
                    for (const msg of events['messages.upsert'].messages) {
                        this.cacheMessage(msg);
                    }
                }
                return originalEvProcess(events);
            };
        }
    }

    cacheMessage(msg) {
        if (msg.key && msg.key.id) {
            const cacheKey = `${msg.key.remoteJid}:${msg.key.id}`;
            this.messageCache.set(cacheKey, {
                message: msg,
                timestamp: Date.now()
            });
            
            // Limit cache size
            if (this.messageCache.size > 1000) {
                const oldestKey = this.messageCache.keys().next().value;
                this.messageCache.delete(oldestKey);
            }
        }
    }

    getCachedMessage(key) {
        const cacheKey = `${key.remoteJid}:${key.id}`;
        const cached = this.messageCache.get(cacheKey);
        return cached ? cached.message : null;
    }

    cleanupMessageCache() {
        const fiveMinutesAgo = Date.now() - 300000;
        for (const [key, value] of this.messageCache) {
            if (value.timestamp < fiveMinutesAgo) {
                this.messageCache.delete(key);
            }
        }
    }

    registerCommandHandler(command, handler) {
        this.commandHandlers.set(command.toLowerCase(), handler);
        logger.debug(`📝 Registered command handler: ${command}`);
    }

    unregisterCommandHandler(command) {
        this.commandHandlers.delete(command.toLowerCase());
        logger.debug(`🗑️ Unregistered command handler: ${command}`);
    }

    registerMessageHook(hookName, handler) {
        if (!this.messageHooks.has(hookName)) {
            this.messageHooks.set(hookName, []);
        }
        this.messageHooks.get(hookName).push(handler);
        logger.debug(`🪝 Registered message hook: ${hookName}`);
    }

    unregisterMessageHook(hookName) {
        this.messageHooks.delete(hookName);
        logger.debug(`🗑️ Unregistered message hook: ${hookName}`);
    }

    async handleMessages({ messages, type }) {
        if (type !== 'notify') return;

        // Process messages concurrently but with user isolation
        const processPromises = messages.map(msg => this.safeProcessMessage(msg));
        await Promise.allSettled(processPromises);
    }

    async safeProcessMessage(msg) {
        try {
            await this.processMessage(msg);
        } catch (error) {
            logger.error('Error processing message:', error?.stack || error?.message || JSON.stringify(error));
            
            // Send error to user if it's a command
            const text = this.extractText(msg);
            const prefix = config.get('bot.prefix');
            if (text && text.startsWith(prefix)) {
                try {
                    await this.bot.sendMessage(msg.key.remoteJid, {
                        text: `❌ An error occurred processing your command. Please try again.`
                    });
                } catch (e) {
                    logger.error('Failed to send error message:', e.message);
                }
            }
        }
    }

    async processMessage(msg) {
        // Cache this message immediately
        this.cacheMessage(msg);
        
        // Handle status messages
        if (msg.key.remoteJid === 'status@broadcast') {
            return this.handleStatusMessage(msg);
        }

        // Extract text from message
        const text = this.extractText(msg);
        
        // Check if it's a command
        const prefix = config.get('bot.prefix');
        const isCommand = text && text.startsWith(prefix) && !this.hasMedia(msg);
        
        // Execute message hooks
        await this.executeMessageHooks('pre_process', msg, text);
        
        if (isCommand) {
            await this.handleCommandWithIsolation(msg, text);
        } else {
            await this.handleNonCommandMessage(msg, text);
        }

        // Execute post-process hooks
        await this.executeMessageHooks('post_process', msg, text);

        // Sync to Telegram if bridge is active
        if (this.bot.telegramBridge) {
            try {
                await this.bot.telegramBridge.syncMessage(msg, text);
            } catch (error) {
                logger.warn('Telegram sync error:', error.message);
            }
        }
    }

    async executeMessageHooks(hookName, msg, text) {
        const hooks = this.messageHooks.get(hookName) || [];
        const hookPromises = hooks.map(hook => {
            return Promise.resolve().then(() => hook(msg, text, this.bot))
                .catch(error => logger.error(`Error executing hook ${hookName}:`, error));
        });
        
        await Promise.allSettled(hookPromises);
    }

    async handleCommandWithIsolation(msg, text) {
        const sender = msg.key.remoteJid;
        const participant = msg.key.participant || sender;
        const userId = participant.split('@')[0];
        const prefix = config.get('bot.prefix');

        const args = text.slice(prefix.length).trim().split(/\s+/);
        const command = args[0].toLowerCase();
        const params = args.slice(1);

        // Permission check (fast, no isolation needed)
        if (!this.checkPermissions(msg, command)) {
            if (config.get('features.sendPermissionError', false)) {
                return this.bot.sendMessage(sender, {
                    text: '❌ You don\'t have permission to use this command.'
                });
            }
            return;
        }

        // Rate limiting check
        if (config.get('features.rateLimiting')) {
            const canExecute = await rateLimiter.checkCommandLimit(userId);
            if (!canExecute) {
                const remainingTime = await rateLimiter.getRemainingTime(userId);
                return this.bot.sendMessage(sender, {
                    text: `⏱️ Rate limit exceeded. Try again in ${Math.ceil(remainingTime / 1000)} seconds.`
                });
            }
        }

        const handler = this.commandHandlers.get(command);
        const respondToUnknown = config.get('features.respondToUnknownCommands', false);

        if (!handler) {
            if (respondToUnknown) {
                return this.bot.sendMessage(sender, {
                    text: `❓ Unknown command: ${command}\nType *${prefix}menu* for available commands.`
                });
            }
            return;
        }

        // Execute command with user isolation
        await this.concurrencyManager.executeWithIsolation(
            userId,
            async (userContext, messageContext) => {
                return await this.executeIsolatedCommand(
                    userContext,
                    handler,
                    msg,
                    params,
                    messageContext
                );
            },
            {
                bot: this.bot,
                sender,
                participant,
                isGroup: sender.endsWith('@g.us'),
                command,
                originalMessage: msg
            }
        );
    }

    async executeIsolatedCommand(userContext, handler, msg, params, context) {
        const { sender, command, originalMessage } = context;
        
        try {
            // Set loading reaction
            await this.bot.sock.sendMessage(sender, {
                react: { key: msg.key, text: '⏳' }
            });

            // Set typing indicator (isolated per user)
            await this.setUserTyping(sender, true);

            // Enhanced context with user isolation
            const enhancedContext = {
                ...context,
                userContext,
                workingDir: userContext.workingDir,
                getWorkingPath: userContext.getWorkingPath.bind(userContext),
                addCleanup: userContext.addCleanup.bind(userContext),
                signal: userContext.abortController.signal,
                // Enhanced getMessage with fallbacks
                getMessage: async (key) => {
                    // Try cache first
                    let message = this.getCachedMessage(key);
                    if (message) return message;
                    
                    // Try store
                    if (this.bot.store) {
                        message = this.bot.store.loadMessage(key.remoteJid, key.id);
                        if (message) return message;
                    }
                    
                    // Try original message if same key
                    if (originalMessage.key.id === key.id && originalMessage.key.remoteJid === key.remoteJid) {
                        return originalMessage;
                    }
                    
                    // Final fallback - return minimal message instead of error
                    return {
                        key,
                        message: { conversation: '' },
                        messageTimestamp: Date.now()
                    };
                }
            };

            // Execute the actual command
            const result = await handler.execute(msg, params, enhancedContext);

            // Clear typing indicator
            await this.setUserTyping(sender, false);

            // Success reaction
            await this.bot.sock.sendMessage(sender, {
                react: { key: msg.key, text: '' }
            });

            logger.info(`✅ Command executed: ${command} by ${context.participant}`);

            if (this.bot.telegramBridge) {
                await this.bot.telegramBridge.logToTelegram('📝 Command Executed',
                    `Command: ${command}\nUser: ${context.participant}\nChat: ${sender}`);
            }

            return result;

        } catch (error) {
            // Clear typing indicator
            await this.setUserTyping(sender, false);

            // Error reaction
            await this.bot.sock.sendMessage(sender, {
                react: { key: msg.key, text: '❌' }
            });

            logger.error(`❌ Command failed: ${command} | ${error.message || 'No message'}`);
            logger.debug(error.stack || error);

            // Send user-friendly error message
            if (!error._handledBySmartError) {
                const errorMsg = error.message && error.message.length < 200 
                    ? error.message 
                    : 'An unexpected error occurred. Please try again.';
                    
                await this.bot.sendMessage(sender, {
                    text: `❌ Command failed: ${errorMsg}`
                });
            }

            if (this.bot.telegramBridge) {
                await this.bot.telegramBridge.logToTelegram('❌ Command Error',
                    `Command: ${command}\nError: ${error.message}\nUser: ${context.participant}`);
            }

            throw error;
        }
    }

    async setUserTyping(jid, isTyping) {
        try {
            if (isTyping) {
                await this.bot.sock.presenceSubscribe(jid);
                await this.bot.sock.sendPresenceUpdate('composing', jid);
            } else {
                await this.bot.sock.sendPresenceUpdate('paused', jid);
            }
        } catch (error) {
            // Ignore presence errors
        }
    }

    hasMedia(msg) {
        return !!(
            msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage ||
            msg.message?.documentMessage ||
            msg.message?.stickerMessage ||
            msg.message?.locationMessage ||
            msg.message?.contactMessage
        );
    }

    async handleStatusMessage(msg) {
        if (config.get('features.autoViewStatus')) {
            try {
                await this.bot.sock.readMessages([msg.key]);
                await this.bot.sock.sendMessage(msg.key.remoteJid, {
                    react: { key: msg.key, text: '❤️' }
                });
                logger.debug(`❤️ Liked status from ${msg.key.participant}`);
            } catch (error) {
                logger.error('Error handling status:', error);
            }
        }
        
        // Sync status messages to Telegram
        if (this.bot.telegramBridge) {
            const text = this.extractText(msg);
            await this.bot.telegramBridge.syncMessage(msg, text);
        }
    }

    async handleNonCommandMessage(msg, text) {
        // Log media messages for debugging
        if (this.hasMedia(msg)) {
            const mediaType = this.getMediaType(msg);
            logger.debug(`📎 Media message received: ${mediaType} from ${msg.key.participant || msg.key.remoteJid}`);
        } else if (text) {
            logger.debug('💬 Text message received:', text.substring(0, 50));
        }
    }

    getMediaType(msg) {
        if (msg.message?.imageMessage) return 'image';
        if (msg.message?.videoMessage) return 'video';
        if (msg.message?.audioMessage) return 'audio';
        if (msg.message?.documentMessage) return 'document';
        if (msg.message?.stickerMessage) return 'sticker';
        if (msg.message?.locationMessage) return 'location';
        if (msg.message?.contactMessage) return 'contact';
        return 'unknown';
    }

    checkPermissions(msg, commandName) {
        const participant = msg.key.participant || msg.key.remoteJid;
        const userId = participant.split('@')[0];
        const ownerId = config.get('bot.owner').split('@')[0];
        const isOwner = userId === ownerId || msg.key.fromMe;

        const admins = config.get('bot.admins') || [];

        const mode = config.get('features.mode');
        if (mode === 'private' && !isOwner && !admins.includes(userId)) return false;

        const blockedUsers = config.get('security.blockedUsers') || [];
        if (blockedUsers.includes(userId)) return false;

        const handler = this.commandHandlers.get(commandName);
        if (!handler) return false;

        const permission = handler.permissions || 'public';

        switch (permission) {
            case 'owner':
                return isOwner;
            case 'admin':
                return isOwner || admins.includes(userId);
            case 'public':
                return true;
            default:
                if (Array.isArray(permission)) {
                    return permission.includes(userId);
                }
                return false;
        }
    }

    extractText(msg) {
        return msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption || 
               msg.message?.documentMessage?.caption ||
               msg.message?.audioMessage?.caption ||
               '';
    }

    async shutdown() {
        await this.concurrencyManager.shutdown();
        this.messageCache.clear();
    }
}

module.exports = MessageHandler;
