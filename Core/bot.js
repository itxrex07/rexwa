const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { makeCacheableSignalKeyStore, getAggregateVotesInPollMessage, isJidNewsletter } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const NodeCache = require('node-cache');

const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler');
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');
const { makeInMemoryStore } = require('./store');

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
        
        // Message retry counter cache for failed decryption/encryption
        this.msgRetryCounterCache = new NodeCache();
        
        // On-demand history sync tracking
        this.onDemandMap = new Map();
        
        // Initialize store
        this.store = makeInMemoryStore({
            logger: logger.child({ module: 'store' }),
            filePath: './store.json',
            autoSaveInterval: 30000 // Auto-save every 30 seconds
        });
        
        // Stability improvements
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 5000;
        this.connectionTimeout = null;
        this.isConnecting = false;
        this.messageQueue = [];
        this.isProcessingMessages = false;
        
        // Load existing store data
        this.store.loadFromFile();
    }
    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');

        try {
            // Database connection with retry logic
            await this.initializeDatabase();
            
            // Initialize Telegram bridge if enabled
            await this.initializeTelegramBridge();
            
            // Load modules
            await this.moduleLoader.loadModules();
            
            // Start WhatsApp connection
            await this.startWhatsApp();

            logger.info('✅ HyperWa Userbot initialized successfully!');
        } catch (error) {
            logger.error('❌ Failed to initialize bot:', error);
            throw error;
        }
    }

    async initializeDatabase() {
        let retries = 3;
        while (retries > 0) {
            try {
                this.db = await connectDb();
                logger.info('✅ Database connected successfully!');
                return;
            } catch (error) {
                retries--;
                logger.error(`❌ Database connection failed (${3 - retries}/3):`, error.message);
                if (retries === 0) {
                    throw new Error('Failed to connect to database after 3 attempts');
                }
                await this.sleep(2000);
            }
        }
    }

    async initializeTelegramBridge() {
        if (!config.get('telegram.enabled')) return;

        try {
            const TelegramBridge = require('../watg-bridge/bridge');
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

    async startWhatsApp() {
        if (this.isConnecting) {
            logger.warn('⚠️ Already attempting to connect, skipping...');
            return;
        }

        this.isConnecting = true;
        
        try {
            await this.cleanupExistingConnection();
            await this.initializeAuthState();
            await this.createSocket();
            await this.waitForConnection();
            
            this.reconnectAttempts = 0; // Reset on successful connection
            this.isConnecting = false;
            
        } catch (error) {
            this.isConnecting = false;
            await this.handleConnectionError(error);
        }
    }

    async cleanupExistingConnection() {
        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            
            try {
                // Remove all listeners to prevent memory leaks
                this.sock.ev.removeAllListeners();
                
                // Clear any existing timeout
                if (this.connectionTimeout) {
                    clearTimeout(this.connectionTimeout);
                    this.connectionTimeout = null;
                }
                
                // Close socket gracefully
                await this.sock.end();
            } catch (error) {
                logger.warn('⚠️ Error during socket cleanup:', error.message);
            } finally {
                this.sock = null;
            }
        }
    }

    async initializeAuthState() {
        let state, saveCreds;

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

        this.authState = { state, saveCreds };
    }

    async createSocket() {
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            auth: this.authState.state,
            version,
                // Caching makes the store faster to send/recv messages
                keys: makeCacheableSignalKeyStore(this.authState.state.keys, logger),
            printQRInTerminal: false,
            logger: logger.child({ module: 'baileys' }),
            getMessage: async (key) => {
                // Try to get message from store first
            }
            getMessage: this.getMessage.bind(this),
            browser: ['HyperWa', 'Chrome', '3.0'],
            // Add connection options for stability
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            // Enable message retry
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 5,
        });

        // Bind store to socket events
        this.store.bind(this.sock.ev);
        
        this.setupEventHandlers();
    }

    async waitForConnection() {
        return new Promise((resolve, reject) => {
            this.connectionTimeout = setTimeout(() => {
                if (!this.sock?.user) {
                    logger.warn('❌ Connection timed out after 60 seconds');
                    reject(new Error('Connection timeout'));
                }
            }, 60000);

            const connectionHandler = (update) => {
                if (update.connection === 'open') {
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    this.sock.ev.off('connection.update', connectionHandler);
                    resolve();
                }
            };

            this.sock.ev.on('connection.update', connectionHandler);
        });
    }

    setupEventHandlers() {
        // Use the process function for efficient batch processing
        this.sock.ev.process(async (events) => {
            // Connection updates
            if (events['connection.update']) {
                try {
                    await this.handleConnectionUpdate(events['connection.update']);
                } catch (error) {
                    logger.error('❌ Error in connection update handler:', error);
                }
            }

            // Credentials update
            if (events['creds.update']) {
                try {
                    await this.authState.saveCreds();
                } catch (error) {
                    logger.error('❌ Error saving credentials:', error);
                }
            }

            // Labels association
            if (events['labels.association']) {
                logger.debug('🏷️ Labels association:', events['labels.association']);
            }

            // Labels edit
            if (events['labels.edit']) {
                logger.debug('✏️ Labels edit:', events['labels.edit']);
            }

            // Call events
            if (events.call) {
                logger.info('📞 Call event received:', events.call);
                await this.handleCallEvent(events.call);
            }

            // History sync
            if (events['messaging-history.set']) {
                await this.handleHistorySync(events['messaging-history.set']);
            }

            // Message upserts
            if (events['messages.upsert']) {
                try {
                    const upsert = events['messages.upsert'];
                    logger.debug('📨 Messages upsert:', { 
                        type: upsert.type, 
                        count: upsert.messages.length,
                        requestId: upsert.requestId 
                    });

                    if (upsert.requestId) {
                        logger.info('📋 Placeholder message received for request:', upsert.requestId);
                    }

                    // Add messages to queue for processing
                    this.messageQueue.push(upsert);
                    await this.processMessageQueue();
                } catch (error) {
                    logger.error('❌ Error handling message upsert:', error);
                }
            }

            // Message updates (status, polls, etc.)
            if (events['messages.update']) {
                await this.handleMessageUpdates(events['messages.update']);
            }

            // Message receipts
            if (events['message-receipt.update']) {
                logger.debug('📬 Message receipt update:', events['message-receipt.update']);
            }

            // Message reactions
            if (events['messages.reaction']) {
                logger.debug('😀 Message reaction:', events['messages.reaction']);
                await this.handleMessageReaction(events['messages.reaction']);
            }

            // Presence updates
            if (events['presence.update']) {
                logger.debug('👤 Presence update:', events['presence.update']);
            }

            // Chat updates
            if (events['chats.update']) {
                logger.debug('💬 Chats update:', events['chats.update']);
            }

            // Contact updates
            if (events['contacts.update']) {
                await this.handleContactUpdates(events['contacts.update']);
            }

            // Chat deletions
            if (events['chats.delete']) {
                logger.info('🗑️ Chats deleted:', events['chats.delete']);
            }
        });
    }

    // Enhanced getMessage function
    async getMessage(key) {
        try {
            // Try to get message from store first
            const message = this.store.loadMessage(key.remoteJid, key.id);
            if (message) {
                return message.message || { conversation: 'Message found but content unavailable' };
            }
            
            // Fallback message
            return { conversation: 'Message not found in store' };
        } catch (error) {
            logger.warn('Error retrieving message from store:', error);
            return { conversation: 'Error retrieving message' };
        }
    }

    // Handle call events
    async handleCallEvent(callEvents) {
        for (const call of callEvents) {
            logger.info(`📞 ${call.status} call from ${call.from}:`, call);
            
            // You can add call handling logic here
            if (call.status === 'offer') {
                // Auto-reject calls if desired
                // await this.sock.rejectCall(call.id, call.from);
            }
        }
    }

    // Handle history sync
    async handleHistorySync(historyData) {
        const { chats, contacts, messages, isLatest, progress, syncType } = historyData;
        
        if (syncType === 'ON_DEMAND') {
            logger.info('📚 Received on-demand history sync:', { messages: messages.length });
        }
        
        logger.info(`📚 History sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages (latest: ${isLatest}, progress: ${progress}%)`);
    }

    // Handle message updates (polls, status changes, etc.)
    async handleMessageUpdates(updates) {
        for (const { key, update } of updates) {
            if (update.pollUpdates) {
                // Handle poll updates
                const pollCreation = this.store.loadMessage(key.remoteJid, key.id);
                if (pollCreation) {
                    const aggregateVotes = getAggregateVotesInPollMessage({
                        message: pollCreation,
                        pollUpdates: update.pollUpdates,
                    });
                    logger.info('📊 Poll update aggregation:', aggregateVotes);
                }
            }
            
            logger.debug('📝 Message update:', { key, update });
        }
    }

    // Handle message reactions
    async handleMessageReaction(reactions) {
        for (const reaction of reactions) {
            logger.debug('😀 Reaction:', reaction);
            // You can add reaction handling logic here
        }
    }

    // Handle contact updates (including profile picture changes)
    async handleContactUpdates(contacts) {
        for (const contact of contacts) {
            if (typeof contact.imgUrl !== 'undefined') {
                try {
                    const newUrl = contact.imgUrl === null
                        ? null
                        : await this.sock.profilePictureUrl(contact.id).catch(() => null);
                    logger.info(`👤 Contact ${contact.id} has new profile pic: ${newUrl}`);
                } catch (error) {
                    logger.warn('Error getting profile picture:', error);
                }
            }
        }
    }

    // Request placeholder resend
    async requestPlaceholderResend(messageKey) {
        try {
            const messageId = await this.sock.requestPlaceholderResend(messageKey);
            logger.info('📋 Requested placeholder resync, ID:', messageId);
            return messageId;
        } catch (error) {
            logger.error('❌ Failed to request placeholder resend:', error);
            throw error;
        }
    }

    // Fetch message history on demand
    async fetchMessageHistory(count, messageKey, messageTimestamp) {
        try {
            const messageId = await this.sock.fetchMessageHistory(count, messageKey, messageTimestamp);
            logger.info('📚 Requested on-demand history sync, ID:', messageId);
            this.onDemandMap.set(messageId, { count, messageKey, messageTimestamp });
            return messageId;
        } catch (error) {
            logger.error('❌ Failed to fetch message history:', error);
            throw error;
        }
    }

    // Send message with typing indicator
    async sendMessageWithTyping(jid, content, delay = 2000) {
        try {
            await this.sock.presenceSubscribe(jid);
            await this.sleep(500);

            await this.sock.sendPresenceUpdate('composing', jid);
            await this.sleep(delay);

            await this.sock.sendPresenceUpdate('paused', jid);

            return await this.sock.sendMessage(jid, content);
        } catch (error) {
            logger.error('❌ Failed to send message with typing:', error);
            throw error;
        }
    }

    async processMessageQueue() {
        if (this.isProcessingMessages || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessingMessages = true;

        try {
            while (this.messageQueue.length > 0) {
                const messageUpdate = this.messageQueue.shift();
                
                // Handle special message types
                if (messageUpdate.type === 'notify') {
                    for (const msg of messageUpdate.messages) {
                        // Handle placeholder resend requests
                        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                        
                        if (text === "requestPlaceholder" && !messageUpdate.requestId) {
                            await this.requestPlaceholderResend(msg.key);
                            continue;
                        }
                        
                        if (text === "onDemandHistSync") {
                            await this.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
                            continue;
                        }
                        
                        // Skip newsletter messages for regular processing
                        if (isJidNewsletter(msg.key?.remoteJid)) {
                            logger.debug('📰 Skipping newsletter message');
                            continue;
                        }
                    }
                }
                
                await this.messageHandler.handleMessages(messageUpdate);
                
                // Small delay to prevent overwhelming the system
                await this.sleep(10);
            }
        } catch (error) {
            logger.error('❌ Error processing message queue:', error);
        } finally {
            this.isProcessingMessages = false;
        }
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
            await this.handleConnectionClose(lastDisconnect);
        } else if (connection === 'open') {
            await this.onConnectionOpen();
        } else if (connection === 'connecting') {
            logger.info('🔄 Connecting to WhatsApp...');
        }
    }

    async handleConnectionClose(lastDisconnect) {
        const statusCode = lastDisconnect?.error?.output?.statusCode || 0;
        const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
        
        logger.warn(`🔌 Connection closed. Status: ${statusCode}, Error: ${errorMessage}`);

        // Handle different disconnect reasons
        switch (statusCode) {
            case DisconnectReason.loggedOut:
                logger.error('❌ Device logged out. Please delete auth_info and restart.');
                await this.clearAuthState();
                process.exit(1);
                break;

            case DisconnectReason.deviceLoggedOut:
                logger.error('❌ Device logged out from another location.');
                await this.clearAuthState();
                process.exit(1);
                break;

            case DisconnectReason.connectionClosed:
            case DisconnectReason.connectionLost:
            case DisconnectReason.connectionReplaced:
            case DisconnectReason.timedOut:
                if (!this.isShuttingDown) {
                    await this.scheduleReconnect();
                }
                break;

            case DisconnectReason.restartRequired:
                logger.info('🔄 Restart required, restarting...');
                if (!this.isShuttingDown) {
                    await this.scheduleReconnect();
                }
                break;

            default:
                if (!this.isShuttingDown) {
                    await this.scheduleReconnect();
                }
        }
    }

    async scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Exiting.`);
            process.exit(1);
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000); // Max 30 seconds
        
        logger.warn(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(async () => {
            if (!this.isShuttingDown) {
                try {
                    await this.startWhatsApp();
                } catch (error) {
                    logger.error('❌ Reconnection failed:', error);
                }
            }
        }, delay);
    }

    async handleConnectionError(error) {
        logger.error('❌ Connection error:', error);
        
        if (!this.isShuttingDown) {
            await this.scheduleReconnect();
        }
    }

    async clearAuthState() {
        if (this.useMongoAuth) {
            try {
                const db = await connectDb();
                const coll = db.collection("auth");
                await coll.deleteOne({ _id: "session" });
                logger.info('🗑️ MongoDB auth session cleared');
            } catch (error) {
                logger.error('❌ Failed to clear MongoDB auth session:', error);
            }
        } else {
            try {
                await fs.remove(this.authPath);
                logger.info('🗑️ File-based auth session cleared');
            } catch (error) {
                logger.error('❌ Failed to clear file-based auth session:', error);
            }
        }
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);

        // Save store after successful connection
        this.store.saveToFile();

        if (!config.get('bot.owner') && this.sock.user) {
            config.set('bot.owner', this.sock.user.id);
            logger.info(`👑 Owner set to: ${this.sock.user.id}`);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.setupWhatsAppHandlers();
            } catch (err) {
                logger.warn('⚠️ Failed to setup Telegram WhatsApp handlers:', err.message);
            }
        }

        await this.sendStartupMessage();

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
        const startupMessage = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is now online!\n\n` +
                              `🔥 *HyperWa Features Active:*\n` +
                              `• 📱 Modular Architecture\n` +
                              `• 🔐 Auth Method: ${authMethod}\n` +
                              `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
                              `• 🔧 Custom Modules: ${config.get('features.customModules') ? '✅' : '❌'}\n` +
                              `Type *${config.get('bot.prefix')}help* for available commands!`;

        try {
            await this.sendMessage(owner, { text: startupMessage });
        } catch (error) {
            logger.warn('⚠️ Failed to send startup message:', error.message);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.logToTelegram('🚀 HyperWa Bot Started', startupMessage);
            } catch (err) {
                logger.warn('⚠️ Telegram log failed:', err.message);
            }
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
        
        try {
            return await this.sock.sendMessage(jid, content);
        } catch (error) {
            logger.error('❌ Failed to send message:', error);
            throw error;
        }
    }

    async shutdown() {
        logger.info('🛑 Shutting down HyperWa Userbot...');
        this.isShuttingDown = true;

        // Clear any pending timeouts
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        // Shutdown Telegram bridge
        if (this.telegramBridge) {
            try {
                await this.telegramBridge.shutdown();
            } catch (err) {
                logger.warn('⚠️ Telegram shutdown error:', err.message);
            }
        }

        // Close WhatsApp socket
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                await this.sock.end();
            } catch (error) {
                logger.warn('⚠️ Error during socket shutdown:', error.message);
            }
        }

        // Close database connection
        if (this.db) {
            try {
                await this.db.close();
            } catch (error) {
                logger.warn('⚠️ Error closing database:', error.message);
            }
        }

        // Cleanup store
        if (this.store) {
            try {
                this.store.cleanup();
            } catch (error) {
                logger.warn('⚠️ Error during store cleanup:', error.message);
            }
        }

        logger.info('✅ HyperWa Userbot shutdown complete');
    }

    // Utility function for delays
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { HyperWaBot };
