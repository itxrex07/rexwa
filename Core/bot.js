const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, proto } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const NodeCache = require('node-cache');

// Import the custom store
const { makeInMemoryStore } = require('./store');

const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler'); // Your enhanced message handler
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');

class HyperWaBot {
    constructor() {
        this.sock = null;
        this.authPath = './auth_info';
        this.messageHandler = new MessageHandler(this);
        this.telegramBridge = null;
        this.isShuttingDown = false;
        this.db = null;
        this.moduleLoader = new ModuleLoader(this);
        this.qrCodeSent = false;
        this.useMongoAuth = config.get('auth.useMongoAuth', false);
        
        // Enhanced store with better concurrency handling
        this.store = makeInMemoryStore({
            logger: logger.child({ module: 'store' }),
            filePath: config.get('store.filePath', './whatsapp-store.json'),
            autoSaveInterval: config.get('store.autoSaveInterval', 30000)
        });

        this.store.loadFromFile();
        
        // Enhanced caching with better isolation
        this.msgRetryCounterCache = new NodeCache({
            stdTTL: 300,
            maxKeys: 1000, // Increased for multi-user
            checkperiod: 60
        });
        
        // Message retrieval cache with better concurrency
        this.messageRetrievalCache = new Map();
        this.maxMessageCacheSize = 2000;
        
        this.autoReply = config.get('features.autoReply', false);
        this.enableTypingIndicators = config.get('features.typingIndicators', true);
        this.autoReadMessages = config.get('features.autoReadMessages', true);
        
        // Enhanced cleanup with proper intervals
        this.setupCleanupIntervals();
        this.setupStoreEventListeners();
    }

    setupCleanupIntervals() {
        // Cleanup message cache
        setInterval(() => {
            if (this.messageRetrievalCache.size > this.maxMessageCacheSize) {
                const entries = Array.from(this.messageRetrievalCache.entries());
                // Remove oldest 25% of entries
                const toRemove = entries.slice(0, Math.floor(entries.length * 0.25));
                for (const [key] of toRemove) {
                    this.messageRetrievalCache.delete(key);
                }
                logger.debug(`🧹 Cleaned up message cache: ${toRemove.length} entries removed`);
            }
        }, 120000); // Every 2 minutes

        // Memory cleanup
        setInterval(() => {
            if (global.gc) {
                global.gc();
                logger.debug('🧹 Forced garbage collection');
            }
        }, 300000); // Every 5 minutes
    }

    setupStoreEventListeners() {
        this.store.on('messages.upsert', (data) => {
            // Cache messages for better retrieval
            for (const msg of data.messages) {
                if (msg.key && msg.key.id) {
                    const cacheKey = `${msg.key.remoteJid}:${msg.key.id}`;
                    this.messageRetrievalCache.set(cacheKey, {
                        message: msg,
                        timestamp: Date.now()
                    });
                }
            }
            logger.debug(`📝 Store: ${data.messages.length} messages cached`);
        });

        this.store.on('contacts.upsert', (contacts) => {
            logger.debug(`👥 Store: ${contacts.length} contacts cached`);
        });

        this.store.on('chats.upsert', (chats) => {
            logger.debug(`💬 Store: ${chats.length} chats cached`);
        });

        // Store statistics
        setInterval(() => {
            const stats = this.getStoreStats();
            logger.info(`📊 Store Stats - Chats: ${stats.chats}, Contacts: ${stats.contacts}, Messages: ${stats.messages}, Cache: ${this.messageRetrievalCache.size}`);
        }, 300000);
    }

    getStoreStats() {
        const chatCount = Object.keys(this.store.chats).length;
        const contactCount = Object.keys(this.store.contacts).length;
        const messageCount = Object.values(this.store.messages)
            .reduce((total, chatMessages) => total + Object.keys(chatMessages).length, 0);
        
        return {
            chats: chatCount,
            contacts: contactCount,
            messages: messageCount
        };
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot with Enhanced Concurrency...');

        try {
            this.db = await connectDb();
            logger.info('✅ Database connected successfully!');
        } catch (error) {
            logger.error('❌ Failed to connect to database:', error);
            process.exit(1);
        }

        if (config.get('telegram.enabled')) {
            try {
                const TelegramBridge = require('../telegram/bridge');
                this.telegramBridge = new TelegramBridge(this);
                await this.telegramBridge.initialize();
                logger.info('✅ Telegram bridge initialized');

                try {
                    await this.telegramBridge.sendStartMessage();
                } catch (err) {
                    logger.warn('⚠️ Failed to send start message via Telegram:', err.message);
                }
            } catch (error) {
                logger.warn('⚠️ Telegram bridge failed to initialize:', error.message);
                this.telegramBridge = null;
            }
        }

        await this.moduleLoader.loadModules();
        await this.startWhatsApp();

        logger.info('✅ HyperWa Userbot with Enhanced Concurrency initialized successfully!');
    }

    async startWhatsApp() {
        let state, saveCreds;

        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        if (this.useMongoAuth) {
            logger.info('🔧 Using MongoDB auth state...');
            try {
                ({ state, saveCreds } = await useMongoAuthState());
            } catch (error) {
                logger.error('❌ Failed to initialize MongoDB auth state:', error);
                logger.info('🔄 Falling back to file-based auth...');
                ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
            }
        } else {
            logger.info('🔧 Using file-based auth state...');
            ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
        }

        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        try {
            this.sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'signal-keys' })),
                },
                version,
                printQRInTerminal: false,
                logger: logger.child({ module: 'baileys' }),
                msgRetryCounterCache: this.msgRetryCounterCache,
                generateHighQualityLinkPreview: true,
                getMessage: this.getMessageWithFallbacks.bind(this),
                browser: ['HyperWa', 'Chrome', '3.0'],
                syncFullHistory: false, // Improve performance for multi-user
                defaultQueryTimeoutMs: 15000,
                connectTimeoutMs: 20000,
                keepAliveIntervalMs: 30000,
                // Enhanced options for better multi-user handling
                markOnlineOnConnect: true,
                fireInitQueries: true,
                emitOwnEvents: false,
                maxMsgRetryCount: 3,
            });

            // Bind store to socket events
            this.store.bind(this.sock.ev);
            logger.info('🔗 Store bound to WhatsApp socket events');

            // Enhanced connection handling
            const connectionPromise = new Promise((resolve, reject) => {
                const connectionTimeout = setTimeout(() => {
                    if (!this.sock.user) {
                        logger.warn('❌ QR code scan timed out after 45 seconds');
                        this.sock.ev.removeAllListeners();
                        this.sock.end();
                        this.sock = null;
                        reject(new Error('QR code scan timed out'));
                    }
                }, 45000); // Increased timeout for multi-user scenarios

                this.sock.ev.on('connection.update', update => {
                    if (update.connection === 'open') {
                        clearTimeout(connectionTimeout);
                        resolve();
                    }
                });
            });

            this.setupEnhancedEventHandlers(saveCreds);
            await connectionPromise;

        } catch (error) {
            logger.error('❌ Failed to initialize WhatsApp socket:', error);
            logger.info('🔄 Retrying with new QR code...');
            setTimeout(() => this.startWhatsApp(), 5000);
        }
    }

    // Enhanced getMessage with multiple fallback strategies
    async getMessageWithFallbacks(key) {
        try {
            // Strategy 1: Check retrieval cache first (fastest)
            const cacheKey = `${key.remoteJid}:${key.id}`;
            const cached = this.messageRetrievalCache.get(cacheKey);
            if (cached && cached.message) {
                logger.debug(`📨 Retrieved message from retrieval cache: ${key.id}`);
                return cached.message;
            }

            // Strategy 2: Check store
            if (this.store && key.remoteJid && key.id) {
                const storedMessage = this.store.loadMessage(key.remoteJid, key.id);
                if (storedMessage && storedMessage.message) {
                    logger.debug(`📨 Retrieved message from store: ${key.id}`);
                    // Cache it for future use
                    this.messageRetrievalCache.set(cacheKey, {
                        message: storedMessage,
                        timestamp: Date.now()
                    });
                    return storedMessage;
                }
            }

            // Strategy 3: Check if it's in message handler cache
            if (this.messageHandler && this.messageHandler.getCachedMessage) {
                const handlerCached = this.messageHandler.getCachedMessage(key);
                if (handlerCached) {
                    logger.debug(`📨 Retrieved message from handler cache: ${key.id}`);
                    return handlerCached;
                }
            }

            // Strategy 4: Create minimal valid message instead of error
            logger.debug(`📨 Creating fallback message for: ${key.id}`);
            const fallbackMessage = {
                key: key,
                message: {
                    conversation: '',
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    }
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
                status: 1
            };

            // Cache the fallback
            this.messageRetrievalCache.set(cacheKey, {
                message: fallbackMessage,
                timestamp: Date.now()
            });

            return fallbackMessage;

        } catch (error) {
            logger.warn(`⚠️ Error in getMessageWithFallbacks for ${key.id}:`, error.message);
            
            // Ultimate fallback - return minimal proto message
            return proto.Message.fromObject({
                conversation: '',
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2
                }
            });
        }
    }

    setupEnhancedEventHandlers(saveCreds) {
        // Use process method for better event handling
        this.sock.ev.process(async (events) => {
            try {
                // Handle connection updates first
                if (events['connection.update']) {
                    await this.handleConnectionUpdate(events['connection.update']);
                }

                // Save credentials
                if (events['creds.update']) {
                    await saveCreds();
                }

                // Handle messages with enhanced error handling
                if (events['messages.upsert']) {
                    await this.handleMessagesUpsertSafely(events['messages.upsert']);
                }

                // Handle other events without blocking
                this.handleOtherEventsSafely(events);

            } catch (error) {
                logger.error('⚠️ Event processing error:', error.message);
                logger.debug(error.stack);
            }
        });
    }

    async handleMessagesUpsertSafely(upsert) {
        try {
            // Cache messages immediately
            for (const msg of upsert.messages) {
                if (msg.key && msg.key.id) {
                    const cacheKey = `${msg.key.remoteJid}:${msg.key.id}`;
                    this.messageRetrievalCache.set(cacheKey, {
                        message: msg,
                        timestamp: Date.now()
                    });
                }
            }

            // Process messages through enhanced message handler
            await this.messageHandler.handleMessages(upsert);

        } catch (error) {
            logger.error('⚠️ Messages upsert error:', error.message);
            // Don't let message processing errors crash the bot
        }
    }

    handleOtherEventsSafely(events) {
        // Handle other events asynchronously without blocking
        setImmediate(() => {
            try {
                if (events['labels.association']) {
                    logger.debug('📋 Label association update');
                }

                if (events['labels.edit']) {
                    logger.debug('📝 Label edit update');
                }

                if (events.call) {
                    logger.info('📞 Call event received');
                    for (const call of events.call) {
                        this.store.setCallOffer?.(call.from, call);
                    }
                }

                if (events['messaging-history.set']) {
                    const { chats, contacts, messages, isLatest, progress } = events['messaging-history.set'];
                    logger.info(`📊 History sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, ${messages?.length || 0} msgs (progress: ${progress}%)`);
                }

                if (events['messages.update']) {
                    logger.debug('📝 Messages updated');
                }

                if (events['message-receipt.update']) {
                    logger.debug('📨 Message receipt update');
                }

                if (events['messages.reaction']) {
                    logger.debug(`😀 Message reactions: ${events['messages.reaction'].length}`);
                }

            } catch (error) {
                logger.debug('Minor event handling error:', error.message);
            }
        });
    }

    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('📱 WhatsApp QR code generated');
            qrcode.generate(qr, { small: true });

            if (this.telegramBridge) {
                try {
                    await this.telegramBridge.sendQRCode(qr);
                } catch (error) {
                    logger.warn('⚠️ TelegramBridge failed to send QR:', error.message);
                }
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode || 0;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            logger.warn(`🔌 Connection closed with status: ${statusCode}`);

            if (shouldReconnect && !this.isShuttingDown) {
                logger.warn('🔄 Connection closed, reconnecting...');
                
                // Save store and cleanup before reconnecting
                this.store.saveToFile();
                this.messageRetrievalCache.clear();
                
                // Exponential backoff for reconnection
                const delay = Math.min(5000 * Math.pow(2, (this.reconnectAttempts || 0)), 30000);
                this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
                
                setTimeout(() => {
                    this.reconnectAttempts = 0; // Reset on successful attempt
                    this.startWhatsApp();
                }, delay);
            } else {
                logger.error('❌ Connection closed permanently. Please delete auth_info and restart.');

                if (this.useMongoAuth) {
                    try {
                        const db = await connectDb();
                        const coll = db.collection("auth");
                        await coll.deleteOne({ _id: "session" });
                        logger.info('🗑️ MongoDB auth session cleared');
                    } catch (error) {
                        logger.error('❌ Failed to clear MongoDB auth session:', error);
                    }
                }

                this.store.saveToFile();
                process.exit(1);
            }
        } else if (connection === 'open') {
            this.reconnectAttempts = 0; // Reset reconnect attempts
            await this.onConnectionOpen();
        }
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);

        // Set owner if not set
        if (!config.get('bot.owner') && this.sock.user) {
            config.set('bot.owner', this.sock.user.id);
            logger.info(`👑 Owner set to: ${this.sock.user.id}`);
        }

        // Initialize Telegram bridge handlers
        if (this.telegramBridge) {
            try {
                await this.telegramBridge.setupWhatsAppHandlers();
            } catch (err) {
                logger.warn('⚠️ Failed to setup Telegram WhatsApp handlers:', err.message);
            }
        }

        // Send startup message
        await this.sendStartupMessage();

        // Sync with Telegram
        if (this.telegramBridge) {
            try {
                await this.telegramBridge.syncWhatsAppConnection();
            } catch (err) {
                logger.warn('⚠️ Telegram sync error:', err.message);
            }
        }
    }

    async sendStartupMessage() {
        const owner = config.get('bot.owner');
        if (!owner) return;

        const authMethod = this.useMongoAuth ? 'MongoDB' : 'File-based';
        const storeStats = this.getStoreStats();
        
        const startupMessage = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is now online!\n\n` +
                              `🔥 *Enhanced Multi-User Features:*\n` +
                              `• 🏗️ User Isolation: ✅\n` +
                              `• 🚀 Concurrent Processing: ✅\n` +
                              `• 📊 Store Stats: ${storeStats.chats} chats, ${storeStats.contacts} contacts\n` +
                              `• 💾 Message Cache: ${this.messageRetrievalCache.size} entries\n` +
                              `• 🔐 Auth Method: ${authMethod}\n` +
                              `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
                              `• 🔧 Enhanced Error Handling: ✅\n` +
                              `• ⚡ Multi-User Ready: ✅\n\n` +
                              `Type *${config.get('bot.prefix')}help* for available commands!`;

        try {
            await this.sendMessageWithTyping({ text: startupMessage }, owner);
        } catch (error) {
            logger.warn('Failed to send startup message:', error.message);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.logToTelegram('🚀 HyperWa Bot Started', 
                    'Enhanced Multi-User Bot is now online with user isolation and concurrent processing!');
            } catch (err) {
                logger.warn('⚠️ Telegram log failed:', err.message);
            }
        }
    }

    async sendMessageWithTyping(content, jid) {
        if (!this.sock) {
            throw new Error('WhatsApp socket not initialized');
        }

        if (!this.enableTypingIndicators) {
            return await this.sock.sendMessage(jid, content);
        }

        try {
            await this.sock.presenceSubscribe(jid);
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.sock.sendPresenceUpdate('composing', jid);
            await new Promise(resolve => setTimeout(resolve, 1500));

            await this.sock.sendPresenceUpdate('paused', jid);

            return await this.sock.sendMessage(jid, content);
        } catch (error) {
            logger.warn('⚠️ Failed to send message with typing:', error.message);
            return await this.sock.sendMessage(jid, content);
        }
    }

    async connect() {
        if (!this.sock) {
            await this.startWhatsApp();
        }
        return this.sock;
    }

    async sendMessage(jid, content) {
        if (!this.sock) {
            throw new Error('WhatsApp socket not initialized');
        }
        
        if (this.enableTypingIndicators && typeof content === 'object' && content.text) {
            return await this.sendMessageWithTyping(content, jid);
        }
        
        return await this.sock.sendMessage(jid, content);
    }

    // Enhanced store methods for better multi-user support
    getChatInfo(jid) {
        return this.store.chats[jid] || null;
    }

    getContactInfo(jid) {
        return this.store.contacts[jid] || null;
    }

    getChatMessages(jid, limit = 50) {
        try {
            const messages = this.store.getMessages(jid);
            return messages.slice(-limit).reverse();
        } catch (error) {
            logger.warn(`Failed to get chat messages for ${jid}:`, error.message);
            return [];
        }
    }

    searchMessages(query, jid = null) {
        try {
            const results = [];
            const chatsToSearch = jid ? [jid] : Object.keys(this.store.messages || {});
            
            for (const chatId of chatsToSearch) {
                try {
                    const messages = this.store.getMessages(chatId) || [];
                    for (const msg of messages) {
                        const text = msg.message?.conversation || 
                                   msg.message?.extendedTextMessage?.text || '';
                        if (text.toLowerCase().includes(query.toLowerCase())) {
                            results.push({
                                chatId,
                                message: msg,
                                text
                            });
                            if (results.length >= 100) break;
                        }
                    }
                } catch (error) {
                    logger.debug(`Search error in chat ${chatId}:`, error.message);
                }
            }
            
            return results;
        } catch (error) {
            logger.warn('Search messages error:', error.message);
            return [];
        }
    }

    // Configuration methods
    setAutoReply(enabled) {
        this.autoReply = enabled;
        config.set('features.autoReply', enabled);
        logger.info(`🤖 Auto-reply ${enabled ? 'enabled' : 'disabled'}`);
    }

    setTypingIndicators(enabled) {
        this.enableTypingIndicators = enabled;
        config.set('features.typingIndicators', enabled);
        logger.info(`⌨️ Typing indicators ${enabled ? 'enabled' : 'disabled'}`);
    }

    setAutoReadMessages(enabled) {
        this.autoReadMessages = enabled;
        config.set('features.autoReadMessages', enabled);
        logger.info(`📖 Auto-read messages ${enabled ? 'enabled' : 'disabled'}`);
    }

    async shutdown() {
        logger.info('🛑 Shutting down HyperWa Userbot...');
        this.isShuttingDown = true;

        // Shutdown message handler and its concurrency manager
        if (this.messageHandler && this.messageHandler.shutdown) {
            await this.messageHandler.shutdown();
        }

        // Cleanup store
        try {
            this.store.cleanup();
            this.store.saveToFile();
        } catch (error) {
            logger.warn('Store cleanup error:', error.message);
        }

        // Clear caches
        this.messageRetrievalCache.clear();
        this.msgRetryCounterCache.flushAll();

        // Shutdown Telegram bridge
        if (this.telegramBridge) {
            try {
                await this.telegramBridge.shutdown();
            } catch (err) {
                logger.warn('⚠️ Telegram shutdown error:', err.message);
            }
        }

        // Close WhatsApp connection
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                await this.sock.end();
            } catch (error) {
                logger.warn('Socket shutdown error:', error.message);
            }
        }

        logger.info('✅ HyperWa Userbot shutdown complete');
    }
}

module.exports = { HyperWaBot };
