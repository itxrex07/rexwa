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
const { makeInMemoryStore } = require('./store'); // Import the store

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

        // Initialize store with enhanced options
        this.store = makeInMemoryStore({
            logger: logger.child({ module: 'store' }),
            filePath: './store/wa_state.json',
            autoSaveInterval: config.get('store.autoSaveInterval', 30000)
        });

        // Load existing store data on startup
        this.store.loadFromFile();

        // Enhanced store event handlers
        this.setupStoreEventHandlers();
    }

    setupStoreEventHandlers() {
        // Contact events
        this.store.on('contacts.set', (contacts) => {
            logger.debug(`📱 ${Object.keys(contacts).length} contacts loaded from store`);
        });

        this.store.on('contacts.upsert', (contacts) => {
            logger.debug(`📱 ${contacts.length} contacts updated in store`);
        });

        // Chat events
        this.store.on('chats.set', (chats) => {
            logger.debug(`💬 ${Object.keys(chats).length} chats loaded from store`);
        });

        this.store.on('chats.upsert', (chats) => {
            logger.debug(`💬 ${chats.length} chats updated in store`);
        });

        // Message events
        this.store.on('messages.set', ({ chatId, messages }) => {
            logger.debug(`📨 ${messages.length} messages loaded for chat ${chatId}`);
        });

        this.store.on('messages.upsert', ({ messages, type }) => {
            logger.debug(`📨 ${messages.length} messages ${type} in store`);
        });

        // Presence events
        this.store.on('presence.update', ({ chatId, presence }) => {
            logger.debug(`👤 Presence updated for ${presence.participant} in ${chatId}: ${presence.lastKnownPresence}`);
        });

        // Group events
        this.store.on('groups.update', (groups) => {
            logger.debug(`👥 ${groups.length} groups updated in store`);
        });
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');

        // Ensure store directory exists
        await fs.ensureDir('./store');

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
                // Enhanced socket options
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: config.get('features.markOnlineOnConnect', true)
            });

            // Bind store to socket events FIRST
            this.store.bind(this.sock.ev);
            logger.info('🗄️ Store bound to WhatsApp events');

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

            // History sync - Enhanced with store integration
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

            // Blocklist updates
            if (events['blocklist.set']) {
                logger.info('🚫 Blocklist updated:', events['blocklist.set']);
            }

            // Blocklist updates
            if (events['blocklist.update']) {
                logger.info('🚫 Blocklist changed:', events['blocklist.update']);
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

            // Save store before reconnecting
            this.store.saveToFile();

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

                // Clear store
                this.store.clear();
                this.store.saveToFile();

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
            
            // Store call information
            if (call.status === 'offer') {
                this.store.setCallOffer(call.from, call);
            } else if (['timeout', 'reject', 'accept'].includes(call.status)) {
                this.store.clearCallOffer(call.from);
            }
            
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
        
        // Mark history as synced for relevant chats
        if (chats) {
            for (const chat of chats) {
                this.store.markHistorySynced(chat.id);
            }
        }
        
        if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
            logger.info('📥 Received on-demand history sync, messages:', messages.length);
        }
        
        logger.info(`📊 History sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, ${messages?.length || 0} msgs (latest: ${isLatest}, progress: ${progress}%)`);
        
        // Save updated store state
        this.store.saveToFile();
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
                // Handle poll updates with store integration
                const pollMessage = this.store.loadMessage(key.remoteJid, key.id);
                if (pollMessage) {
                    const aggregation = getAggregateVotesInPollMessage({
                        message: pollMessage,
                        pollUpdates: update.pollUpdates,
                    });
                    logger.info('📊 Poll update aggregation:', aggregation);
                    
                    // Store poll update
                    if (!this.store.poll_message.message) {
                        this.store.poll_message.message = [];
                    }
                    this.store.poll_message.message.push({
                        key: key,
                        update: update,
                        aggregation: aggregation,
                        timestamp: Date.now()
                    });
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
            const participantPresences = presence.presences;
            if (participantPresences) {
                Object.entries(participantPresences).forEach(([participant, presenceInfo]) => {
                    logger.debug(`👤 Presence update for ${participant} in ${presence.id}: ${presenceInfo.lastKnownPresence}`);
                    
                    // Update presence in store
                    this.store.updatePresence(presence.id, {
                        participant: participant,
                        ...presenceInfo
                    });
                });
            }
        }
    }

    async handleContactsUpdate(contacts) {
        for (const contact of contacts) {
            if (typeof contact.imgUrl !== 'undefined') {
                const newUrl = contact.imgUrl === null
                    ? null
                    : await this.sock.profilePictureUrl(contact.id).catch(() => null);
                
                logger.info(`👤 Contact ${contact.id} has a new profile pic: ${newUrl}`);
                
                // Update contact in store
                this.store.upsertContact({
                    id: contact.id,
                    imgUrl: newUrl,
                    ...contact
                });
                
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
        if (key?.remoteJid && key?.id) {
            const storedMessage = this.store.loadMessage(key.remoteJid, key.id);
            if (storedMessage) {
                logger.debug('📨 Retrieved message from store:', key.id);
                return storedMessage;
            }
        }
        
        // Fallback
        logger.warn('📨 Message not found in store:', key);
        return proto.Message.fromObject({ conversation: 'Message not found in store' });
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);

        if (!config.get('bot.owner') && this.sock.user) {
            config.set('bot.owner', this.sock.user.id);
            logger.info(`👑 Owner set to: ${this.sock.user.id}`);
        }

        // Store auth state
        this.store.setAuthState({
            userId: this.sock.user?.id,
            connectedAt: Date.now(),
            platform: 'HyperWa'
        });

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

        // Save store state after successful connection
        this.store.saveToFile();
    }

    async sendStartupMessage() {
        const owner = config.get('bot.owner');
        if (!owner) return;

        const authMethod = this.useMongoAuth ? 'MongoDB' : 'File-based';
        const storeStats = this.getStoreStats();
        
        const startupMessage = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is now online!\n\n` +
                              `🔥 *HyperWa Features Active:*\n` +
                              `• 📱 Modular Architecture\n` +
                              `• 🔐 Auth Method: ${authMethod}\n` +
                              `• 🗄️ Store: ${storeStats.contacts} contacts, ${storeStats.chats} chats, ${storeStats.messages} msgs\n` +
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

    // Store-related utility methods
    getStoreStats() {
        return {
            contacts: Object.keys(this.store.contacts).length,
            chats: Object.keys(this.store.chats).length,
            messages: Object.keys(this.store.messages).reduce((total, chatId) => {
                return total + Object.keys(this.store.messages[chatId]).length;
            }, 0),
            groupMetadata: Object.keys(this.store.groupMetadata).length,
            callOffers: Object.keys(this.store.callOffer).length,
            stickerPacks: Object.keys(this.store.stickerPacks).length
        };
    }

    // Enhanced message retrieval methods using store
    async getChat(jid) {
        return this.store.chats[jid] || null;
    }

    async getContact(jid) {
        return this.store.contacts[jid] || null;
    }

    async getChatMessages(jid, limit = 50) {
        const messages = this.store.getMessages(jid);
        return messages.slice(-limit).reverse(); // Get latest messages
    }

    async searchMessages(query, jid = null) {
        const results = [];
        const chatsToSearch = jid ? [jid] : Object.keys(this.store.messages);
        
        for (const chatId of chatsToSearch) {
            const messages = this.store.getMessages(chatId);
            for (const msg of messages) {
                const text = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || 
                           msg.message?.imageMessage?.caption ||
                           msg.message?.videoMessage?.caption;
                           
                if (text && text.toLowerCase().includes(query.toLowerCase())) {
                    results.push({ chatId, message: msg });
                }
            }
        }
        
        return results.slice(0, 100); // Limit results
    }

    async getGroupMetadata(jid) {
        // Try store first, then fetch from WhatsApp
        let metadata = this.store.groupMetadata[jid];
        if (!metadata && this.sock) {
            try {
                metadata = await this.sock.groupMetadata(jid);
                this.store.setGroupMetadata(jid, metadata);
            } catch (error) {
                logger.warn(`Failed to fetch group metadata for ${jid}:`, error.message);
            }
        }
        return metadata;
    }

    async isHistorySynced(jid) {
        return this.store.isHistorySynced(jid);
    }

    // Store management methods
    clearStore() {
        this.store.clear();
        logger.info('🗑️ Store cleared');
    }

    saveStore() {
        this.store.saveToFile();
        logger.info('💾 Store saved to file');
    }

    async exportStore() {
        const state = this.store.save();
        const filePath = `./exports/store_backup_${Date.now()}.json`;
        await fs.ensureDir('./exports');
        await fs.writeJSON(filePath, state, { spaces: 2 });
        logger.info(`📤 Store exported to ${filePath}`);
        return filePath;
    }

    async importStore(filePath) {
        try {
            const state = await fs.readJSON(filePath);
            this.store.load(state);
            this.store.saveToFile();
            logger.info(`📥 Store imported from ${filePath}`);
            return true;
        } catch (error) {
            logger.error(`Failed to import store from ${filePath}:`, error.message);
            return false;
        }
    }

    // Enhanced connection methods
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

    // Store-based analytics methods
    async getChatAnalytics(jid) {
        const messages = this.store.getMessages(jid);
        const chat = this.store.chats[jid];
        
        if (!messages.length) return null;

        const analytics = {
            totalMessages: messages.length,
            myMessages: messages.filter(msg => msg.key.fromMe).length,
            otherMessages: messages.filter(msg => !msg.key.fromMe).length,
            mediaMessages: messages.filter(msg => 
                msg.message?.imageMessage || 
                msg.message?.videoMessage || 
                msg.message?.audioMessage || 
                msg.message?.documentMessage
            ).length,
            lastMessage: messages[messages.length - 1],
            firstMessage: messages[0],
            chatInfo: chat
        };

        analytics.responseRate = analytics.otherMessages > 0 
            ? (analytics.myMessages / analytics.otherMessages * 100).toFixed(2) + '%'
            : '0%';

        return analytics;
    }

    async getTopChats(limit = 10) {
        const chatStats = Object.keys(this.store.messages).map(jid => {
            const messages = this.store.getMessages(jid);
            const chat = this.store.chats[jid];
            
            return {
                jid,
                name: chat?.name || chat?.pushName || jid,
                messageCount: messages.length,
                lastActivity: messages.length > 0 ? messages[messages.length - 1].messageTimestamp : 0,
                isGroup: jid.includes('@g.us')
            };
        });

        return chatStats
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, limit);
    }

    async getRecentActivity(hours = 24) {
        const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
        const recentMessages = [];

        Object.keys(this.store.messages).forEach(jid => {
            const messages = this.store.getMessages(jid);
            const recent = messages.filter(msg => 
                (msg.messageTimestamp * 1000) > cutoffTime
            );
            
            if (recent.length > 0) {
                recentMessages.push({
                    jid,
                    name: this.store.chats[jid]?.name || jid,
                    messageCount: recent.length,
                    lastMessage: recent[recent.length - 1]
                });
            }
        });

        return recentMessages.sort((a, b) => b.messageCount - a.messageCount);
    }

    // Enhanced presence management
    async getPresenceInfo(jid) {
        const presences = this.store.presences[jid];
        if (!presences) return null;

        const presenceInfo = {};
        Object.entries(presences).forEach(([participant, presence]) => {
            presenceInfo[participant] = {
                status: presence.lastKnownPresence,
                lastSeen: presence.lastSeen,
                isOnline: presence.lastKnownPresence === 'available'
            };
        });

        return presenceInfo;
    }

    async subscribeToPresence(jids) {
        if (!this.sock) return;
        
        const jidArray = Array.isArray(jids) ? jids : [jids];
        
        for (const jid of jidArray) {
            try {
                await this.sock.presenceSubscribe(jid);
                logger.debug(`👤 Subscribed to presence updates for ${jid}`);
            } catch (error) {
                logger.warn(`Failed to subscribe to presence for ${jid}:`, error.message);
            }
        }
    }

    // Enhanced group management using store
    async getGroupParticipants(jid) {
        const metadata = await this.getGroupMetadata(jid);
        return metadata?.participants || [];
    }

    async isGroupAdmin(jid, participantJid) {
        const participants = await this.getGroupParticipants(jid);
        const participant = participants.find(p => p.id === participantJid);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    }

    async getGroupAdmins(jid) {
        const participants = await this.getGroupParticipants(jid);
        return participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
    }

    // Backup and restore methods
    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupData = {
            timestamp: Date.now(),
            version: config.get('bot.version'),
            store: this.store.save(),
            config: {
                autoReply: this.autoReply,
                enableTypingIndicators: this.enableTypingIndicators,
                autoReadMessages: this.autoReadMessages
            },
            stats: this.getStoreStats()
        };

        const backupPath = `./backups/backup_${timestamp}.json`;
        await fs.ensureDir('./backups');
        await fs.writeJSON(backupPath, backupData, { spaces: 2 });
        
        logger.info(`📦 Backup created: ${backupPath}`);
        return backupPath;
    }

    async restoreBackup(backupPath) {
        try {
            const backupData = await fs.readJSON(backupPath);
            
            // Restore store
            if (backupData.store) {
                this.store.load(backupData.store);
                this.store.saveToFile();
            }
            
            // Restore configuration
            if (backupData.config) {
                this.autoReply = backupData.config.autoReply;
                this.enableTypingIndicators = backupData.config.enableTypingIndicators;
                this.autoReadMessages = backupData.config.autoReadMessages;
            }
            
            logger.info(`📦 Backup restored from: ${backupPath}`);
            logger.info(`📊 Restored: ${JSON.stringify(backupData.stats)}`);
            
            return true;
        } catch (error) {
            logger.error(`Failed to restore backup from ${backupPath}:`, error.message);
            return false;
        }
    }

    // Message template system using store
    saveMessageTemplate(name, content) {
        if (!this.store.messageTemplates) {
            this.store.messageTemplates = {};
        }
        
        this.store.messageTemplates[name] = {
            content,
            createdAt: Date.now(),
            usageCount: 0
        };
        
        this.store.saveToFile();
        logger.info(`📝 Message template '${name}' saved`);
    }

    getMessageTemplate(name) {
        if (!this.store.messageTemplates || !this.store.messageTemplates[name]) {
            return null;
        }
        
        // Increment usage count
        this.store.messageTemplates[name].usageCount++;
        this.store.saveToFile();
        
        return this.store.messageTemplates[name].content;
    }

    listMessageTemplates() {
        if (!this.store.messageTemplates) return [];
        
        return Object.entries(this.store.messageTemplates).map(([name, template]) => ({
            name,
            content: template.content.substring(0, 50) + (template.content.length > 50 ? '...' : ''),
            usageCount: template.usageCount,
            createdAt: new Date(template.createdAt).toLocaleString()
        }));
    }

    deleteMessageTemplate(name) {
        if (!this.store.messageTemplates || !this.store.messageTemplates[name]) {
            return false;
        }
        
        delete this.store.messageTemplates[name];
        this.store.saveToFile();
        logger.info(`🗑️ Message template '${name}' deleted`);
        return true;
    }

    // Advanced message filtering and search
    async searchMessagesAdvanced(options = {}) {
        const {
            query,
            jid,
            fromMe,
            messageType,
            dateFrom,
            dateTo,
            limit = 100
        } = options;

        const results = [];
        const chatsToSearch = jid ? [jid] : Object.keys(this.store.messages);

        for (const chatId of chatsToSearch) {
            const messages = this.store.getMessages(chatId);
            
            for (const msg of messages) {
                // Apply filters
                if (fromMe !== undefined && msg.key.fromMe !== fromMe) continue;
                
                if (dateFrom && (msg.messageTimestamp * 1000) < dateFrom) continue;
                if (dateTo && (msg.messageTimestamp * 1000) > dateTo) continue;
                
                if (messageType) {
                    const hasType = msg.message && msg.message[messageType];
                    if (!hasType) continue;
                }
                
                if (query) {
                    const text = msg.message?.conversation || 
                               msg.message?.extendedTextMessage?.text || 
                               msg.message?.imageMessage?.caption ||
                               msg.message?.videoMessage?.caption || '';
                               
                    if (!text.toLowerCase().includes(query.toLowerCase())) continue;
                }
                
                results.push({
                    chatId,
                    chatName: this.store.chats[chatId]?.name || chatId,
                    message: msg,
                    timestamp: new Date(msg.messageTimestamp * 1000),
                    preview: this.getMessagePreview(msg)
                });
                
                if (results.length >= limit) break;
            }
            
            if (results.length >= limit) break;
        }

        return results.sort((a, b) => b.message.messageTimestamp - a.message.messageTimestamp);
    }

    getMessagePreview(msg, maxLength = 100) {
        const text = msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || 
                   msg.message?.imageMessage?.caption ||
                   msg.message?.videoMessage?.caption;
                   
        if (text) {
            return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
        }
        
        // Handle other message types
        if (msg.message?.imageMessage) return '📷 Image';
        if (msg.message?.videoMessage) return '🎥 Video';
        if (msg.message?.audioMessage) return '🎵 Audio';
        if (msg.message?.documentMessage) return '📄 Document';
        if (msg.message?.locationMessage) return '📍 Location';
        if (msg.message?.contactMessage) return '👤 Contact';
        if (msg.message?.stickerMessage) return '🎭 Sticker';
        
        return '💬 Message';
    }

    // Cleanup and maintenance
    async performMaintenance() {
        logger.info('🔧 Starting store maintenance...');
        
        let cleaned = 0;
        const cutoffTime = Date.now() - (config.get('store.messageRetentionDays', 30) * 24 * 60 * 60 * 1000);
        
        // Clean old messages if retention is enabled
        if (config.get('store.enableMessageRetention', false)) {
            Object.keys(this.store.messages).forEach(jid => {
                const messages = this.store.messages[jid];
                const messageIds = Object.keys(messages);
                
                messageIds.forEach(msgId => {
                    const msg = messages[msgId];
                    if ((msg.messageTimestamp * 1000) < cutoffTime) {
                        delete messages[msgId];
                        cleaned++;
                    }
                });
            });
        }
        
        // Clean empty chat objects
        Object.keys(this.store.messages).forEach(jid => {
            if (Object.keys(this.store.messages[jid]).length === 0) {
                delete this.store.messages[jid];
            }
        });
        
        // Save cleaned store
        this.store.saveToFile();
        
        logger.info(`✅ Maintenance complete. Cleaned ${cleaned} old messages`);
        return { cleanedMessages: cleaned };
    }

    async shutdown() {
        logger.info('🛑 Shutting down HyperWa Userbot...');
        this.isShuttingDown = true;

        // Stop store auto-save and perform final save
        this.store.cleanup();

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
