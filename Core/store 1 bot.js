const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, getAggregateVotesInPollMessage, isJidNewsletter, delay, proto } = require('@whiskeysockets/baileys');
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
const { makeInMemoryStore } = require('./store'); // Import your store

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
        
        // Enhanced features from example
        this.msgRetryCounterCache = new NodeCache();
        this.onDemandMap = new Map();
        this.autoReply = config.get('features.autoReply', false);
        this.enableTypingIndicators = config.get('features.typingIndicators', true);
        this.autoReadMessages = config.get('features.autoReadMessages', true);

        // Initialize the store
        this.store = makeInMemoryStore({
            logger: logger.child({ module: 'store' }),
            filePath: './store-data.json',
            autoSaveInterval: 30000 // Save every 30 seconds
        });

        // Load existing store data
        this.store.loadFromFile();
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');

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

        logger.info('✅ HyperWa Userbot initialized successfully!');
    }

    async startWhatsApp() {
        let state, saveCreds;

        // Clean up existing socket if present
        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        // Choose auth method based on configuration
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
                getMessage: this.getMessage.bind(this),
                browser: ['HyperWa', 'Chrome', '3.0'],
            });

            // Bind store to socket events - THIS IS THE KEY INTEGRATION
            this.store.bind(this.sock.ev);

            const connectionPromise = new Promise((resolve, reject) => {
                const connectionTimeout = setTimeout(() => {
                    if (!this.sock.user) {
                        logger.warn('❌ QR code scan timed out after 30 seconds');
                        this.sock.ev.removeAllListeners();
                        this.sock.end();
                        this.sock = null;
                        reject(new Error('QR code scan timed out'));
                    }
                }, 30000);

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

    setupEnhancedEventHandlers(saveCreds) {
        // Enhanced event processing like in the example
        this.sock.ev.process(async (events) => {
            // Connection updates
            if (events['connection.update']) {
                await this.handleConnectionUpdate(events['connection.update']);
            }

            // Credentials updates
            if (events['creds.update']) {
                await saveCreds();
            }

            // Label association handling
            if (events['labels.association']) {
                logger.info('📋 Label association update:', events['labels.association']);
            }

            // Label edit handling
            if (events['labels.edit']) {
                logger.info('📝 Label edit update:', events['labels.edit']);
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

            // Messages upsert (new/updated messages)
            if (events['messages.upsert']) {
                await this.handleMessagesUpsert(events['messages.upsert']);
            }

            // Message updates (delivery, read, etc.)
            if (events['messages.update']) {
                await this.handleMessagesUpdate(events['messages.update']);
            }

            // Message receipts
            if (events['message-receipt.update']) {
                logger.debug('📨 Message receipt update:', events['message-receipt.update']);
            }

            // Message reactions
            if (events['messages.reaction']) {
                await this.handleMessageReaction(events['messages.reaction']);
            }

            // Presence updates
            if (events['presence.update']) {
                await this.handlePresenceUpdate(events['presence.update']);
            }

            // Chat updates
            if (events['chats.update']) {
                logger.debug('💬 Chats updated:', events['chats.update'].length);
            }

            // Contact updates
            if (events['contacts.update']) {
                await this.handleContactsUpdate(events['contacts.update']);
            }

            // Chat deletions
            if (events['chats.delete']) {
                logger.info('🗑️ Chats deleted:', events['chats.delete']);
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

            if (shouldReconnect && !this.isShuttingDown) {
                logger.warn('🔄 Connection closed, reconnecting...');
                setTimeout(() => this.startWhatsApp(), 5000);
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

                process.exit(1);
            }
        } else if (connection === 'open') {
            await this.onConnectionOpen();
        }

        logger.debug('🔗 Connection update:', update);
    }

    async handleCallEvent(callEvents) {
        for (const call of callEvents) {
            logger.info(`📞 ${call.isVideo ? 'Video' : 'Voice'} call ${call.status} from ${call.from}`);
            
            if (this.telegramBridge) {
                try {
                    await this.telegramBridge.logToTelegram(
                        '📞 Call Event',
                        `${call.isVideo ? 'Video' : 'Voice'} call ${call.status} from ${call.from}`
                    );
                } catch (err) {
                    logger.warn('⚠️ Failed to log call to Telegram:', err.message);
                }
            }
        }
    }

    async handleHistorySync(historyData) {
        const { chats, contacts, messages, isLatest, progress, syncType } = historyData;
        
        if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
            logger.info('📥 Received on-demand history sync, messages:', messages.length);
        }
        
        logger.info(`📊 History sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (latest: ${isLatest}, progress: ${progress}%)`);
    }

    async handleMessagesUpsert(upsert) {
        logger.debug('📨 Messages upsert:', JSON.stringify(upsert, null, 2));

        if (upsert.requestId) {
            logger.info(`🔄 Placeholder message received for request ID: ${upsert.requestId}`);
        }

        if (upsert.type === 'notify') {
            for (const msg of upsert.messages) {
                await this.processIncomingMessage(msg, upsert);
            }
        }

        // Call original message handler
        await this.messageHandler.handleMessages({ messages: upsert.messages, type: upsert.type });
    }

    async processIncomingMessage(msg, upsert) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        
        if (!text) return;

        // Handle special commands
        if (text === "requestPlaceholder" && !upsert.requestId) {
            const messageId = await this.sock.requestPlaceholderResend(msg.key);
            logger.info('🔄 Requested placeholder resync, ID:', messageId);
            return;
        }

        if (text === "onDemandHistSync") {
            const messageId = await this.sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
            logger.info('📥 Requested on-demand sync, ID:', messageId);
            return;
        }

        // Auto-reply functionality
        if (!msg.key.fromMe && this.autoReply && !isJidNewsletter(msg.key?.remoteJid)) {
            logger.info('🤖 Auto-replying to:', msg.key.remoteJid);
            
            if (this.autoReadMessages) {
                await this.sock.readMessages([msg.key]);
            }
            
            const replyText = config.get('messages.autoReplyText', 'Hello there! This is an automated response.');
            await this.sendMessageWithTyping({ text: replyText }, msg.key.remoteJid);
        }
    }

    async handleMessagesUpdate(updates) {
        logger.debug('📝 Messages update:', JSON.stringify(updates, null, 2));

        for (const { key, update } of updates) {
            if (update.pollUpdates) {
                // Handle poll updates using store
                const pollMessage = this.store.loadMessage(key.remoteJid, key.id);
                if (pollMessage) {
                    const aggregation = getAggregateVotesInPollMessage({
                        message: pollMessage,
                        pollUpdates: update.pollUpdates,
                    });
                    logger.info('📊 Poll update aggregation:', aggregation);
                }
            }
        }
    }

    async handleMessageReaction(reactions) {
        for (const reaction of reactions) {
            logger.info(`😀 Reaction ${reaction.reaction.text || 'removed'} by ${reaction.key.participant || reaction.key.remoteJid}`);
            
            if (this.telegramBridge) {
                try {
                    await this.telegramBridge.logToTelegram(
                        '😀 Message Reaction',
                        `Reaction: ${reaction.reaction.text || 'removed'} by ${reaction.key.participant || reaction.key.remoteJid}`
                    );
                } catch (err) {
                    logger.warn('⚠️ Failed to log reaction to Telegram:', err.message);
                }
            }
        }
    }

    async handlePresenceUpdate(presences) {
        for (const presence of presences) {
            logger.debug(`👤 Presence update for ${presence.id}: ${presence.presences?.[Object.keys(presence.presences)[0]]?.lastKnownPresence}`);
        }
    }

    async handleContactsUpdate(contacts) {
        for (const contact of contacts) {
            if (typeof contact.imgUrl !== 'undefined') {
                const newUrl = contact.imgUrl === null
                    ? null
                    : await this.sock.profilePictureUrl(contact.id).catch(() => null);
                
                logger.info(`👤 Contact ${contact.id} has a new profile pic: ${newUrl}`);
                
                if (this.telegramBridge) {
                    try {
                        await this.telegramBridge.logToTelegram(
                            '👤 Profile Update',
                            `Contact ${contact.id} updated their profile picture`
                        );
                    } catch (err) {
                        logger.warn('⚠️ Failed to log profile update to Telegram:', err.message);
                    }
                }
            }
        }
    }

    async sendMessageWithTyping(content, jid) {
        if (!this.sock || !this.enableTypingIndicators) {
            return await this.sock?.sendMessage(jid, content);
        }

        try {
            await this.sock.presenceSubscribe(jid);
            await delay(500);

            await this.sock.sendPresenceUpdate('composing', jid);
            await delay(2000);

            await this.sock.sendPresenceUpdate('paused', jid);

            return await this.sock.sendMessage(jid, content);
        } catch (error) {
            logger.warn('⚠️ Failed to send message with typing:', error.message);
            return await this.sock.sendMessage(jid, content);
        }
    }

    async getMessage(key) {
        // Enhanced message retrieval using store
        if (this.store) {
            const message = this.store.loadMessage(key.remoteJid, key.id);
            if (message) {
                return message.message || proto.Message.fromObject({ conversation: 'Message from store' });
            }
        }
        
        // Fallback
        return proto.Message.fromObject({ conversation: 'Message not found' });
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);

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
                              `• 💾 In-Memory Store: ✅\n` +
                              `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
                              `• 🔧 Custom Modules: ${config.get('features.customModules') ? '✅' : '❌'}\n` +
                              `• ⌨️ Typing Indicators: ${this.enableTypingIndicators ? '✅' : '❌'}\n` +
                              `• 📖 Auto Read: ${this.autoReadMessages ? '✅' : '❌'}\n` +
                              `• 🤖 Auto Reply: ${this.autoReply ? '✅' : '❌'}\n` +
                              `Type *${config.get('bot.prefix')}help* for available commands!`;

        try {
            await this.sendMessageWithTyping({ text: startupMessage }, owner);
        } catch {}

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
        
        if (this.enableTypingIndicators) {
            return await this.sendMessageWithTyping(content, jid);
        }
        
        return await this.sock.sendMessage(jid, content);
    }

    // Enhanced store utility methods
    getStoredContacts() {
        return this.store?.contacts || {};
    }

    getStoredChats() {
        return this.store?.chats || {};
    }

    getChatMessages(jid) {
        return this.store?.getMessages(jid) || [];
    }

    getContactInfo(jid) {
        return this.store?.contacts[jid] || null;
    }

    getChatInfo(jid) {
        return this.store?.chats[jid] || null;
    }

    getGroupMetadata(groupId) {
        return this.store?.groupMetadata[groupId] || null;
    }

    // Store management methods
    clearStore() {
        if (this.store) {
            this.store.clear();
            logger.info('🧹 Store cleared');
        }
    }

    saveStoreToFile() {
        if (this.store) {
            this.store.saveToFile();
            logger.info('💾 Store saved to file');
        }
    }

    // New enhanced methods
    async requestPlaceholderResend(messageKey) {
        if (!this.sock) return null;
        return await this.sock.requestPlaceholderResend(messageKey);
    }

    async fetchMessageHistory(count, fromKey, timestamp) {
        if (!this.sock) return null;
        return await this.sock.fetchMessageHistory(count, fromKey, timestamp);
    }

    async readMessages(keys) {
        if (!this.sock) return;
        return await this.sock.readMessages(keys);
    }

    async updatePresence(presence, jid) {
        if (!this.sock) return;
        return await this.sock.sendPresenceUpdate(presence, jid);
    }

    async subscribePresence(jid) {
        if (!this.sock) return;
        return await this.sock.presenceSubscribe(jid);
    }

    async getProfilePicture(jid) {
        if (!this.sock) return null;
        try {
            return await this.sock.profilePictureUrl(jid);
        } catch {
            return null;
        }
    }

    // Configuration methods for new features
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

        // Clean up store
        if (this.store) {
            this.store.cleanup();
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.shutdown();
            } catch (err) {
                logger.warn('⚠️ Telegram shutdown error:', err.message);
            }
        }

        if (this.sock) {
            await this.sock.end();
        }

        logger.info('✅ HyperWa Userbot shutdown complete');
    }
}

module.exports = { HyperWaBot };
