const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const logger = require('../Core/logger');
const TelegramCommands = require('./commands');
const { connectDb } = require('../utils/db');
const fs = require('fs-extra');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

class TelegramBridge {
    constructor(whatsappBot) {
        this.whatsappBot = whatsappBot;
        this.telegramBot = null;
        this.commands = null;
        this.isInitialized = false;
        this.db = null;
        
        // Configuration
        this.config = {
            botToken: config.get('telegram.botToken'),
            chatId: config.get('telegram.chatId'),
            logChannel: config.get('telegram.logChannel'),
            botPassword: config.get('telegram.botPassword'),
            features: config.get('telegram.features')
        };
        
        // State management
        this.chatMappings = new Map();
        this.contactMappings = new Map();
        this.userMappings = new Map();
        this.topicMappings = new Map();
        this.filters = new Set();
        this.authenticatedUsers = new Set();
        this.messageQueue = [];
        this.isProcessingQueue = false;
        
        // Statistics
        this.stats = {
            messagesSynced: 0,
            mediaProcessed: 0,
            errorsHandled: 0,
            startTime: Date.now()
        };
        
        // Rate limiting
        this.rateLimiter = {
            messages: new Map(),
            maxPerMinute: 20,
            cleanup: () => {
                const now = Date.now();
                for (const [key, timestamps] of this.rateLimiter.messages) {
                    const filtered = timestamps.filter(t => now - t < 60000);
                    if (filtered.length === 0) {
                        this.rateLimiter.messages.delete(key);
                    } else {
                        this.rateLimiter.messages.set(key, filtered);
                    }
                }
            }
        };
        
        // Cleanup rate limiter every minute
        setInterval(() => this.rateLimiter.cleanup(), 60000);
    }

    async initialize() {
        if (this.isInitialized) return;
        
        try {
            // Initialize database
            this.db = await connectDb();
            
            // Initialize Telegram bot
            this.telegramBot = new TelegramBot(this.config.botToken, { 
                polling: true,
                request: {
                    agentOptions: {
                        keepAlive: true,
                        family: 4
                    }
                }
            });
            
            // Initialize commands handler
            this.commands = new TelegramCommands(this);
            
            // Load saved data
            await this.loadMappingsFromDb();
            await this.loadFiltersFromDb();
            
            // Setup event handlers
            this.setupTelegramHandlers();
            
            // Register bot commands
            await this.commands.registerBotCommands();
            
            this.isInitialized = true;
            logger.info('✅ Telegram bridge initialized successfully');
            
        } catch (error) {
            logger.error('❌ Failed to initialize Telegram bridge:', error);
            throw error;
        }
    }

    setupTelegramHandlers() {
        // Handle text messages and commands
        this.telegramBot.on('message', async (msg) => {
            try {
                if (msg.text && msg.text.startsWith('/')) {
                    await this.commands.handleCommand(msg);
                } else {
                    await this.handleTelegramMessage(msg);
                }
            } catch (error) {
                logger.error('❌ Error handling Telegram message:', error);
                this.stats.errorsHandled++;
            }
        });

        // Handle callback queries
        this.telegramBot.on('callback_query', async (query) => {
            try {
                await this.handleCallbackQuery(query);
            } catch (error) {
                logger.error('❌ Error handling callback query:', error);
            }
        });

        // Handle errors
        this.telegramBot.on('error', (error) => {
            logger.error('❌ Telegram bot error:', error);
            this.stats.errorsHandled++;
        });

        // Handle polling errors
        this.telegramBot.on('polling_error', (error) => {
            logger.error('❌ Telegram polling error:', error);
        });
    }

    async handleTelegramMessage(msg) {
        // Check authentication for private chats
        if (msg.chat.type === 'private' && !this.authenticatedUsers.has(msg.from.id)) {
            if (msg.text === this.config.botPassword) {
                this.authenticatedUsers.add(msg.from.id);
                await this.telegramBot.sendMessage(msg.chat.id, '✅ Authentication successful!');
                return;
            } else {
                await this.telegramBot.sendMessage(msg.chat.id, '🔐 Please enter the bot password to continue.');
                return;
            }
        }

        // Handle forwarding to WhatsApp
        if (this.config.features.biDirectional && msg.text && !msg.text.startsWith('/')) {
            await this.forwardToWhatsApp(msg);
        }
    }

    async forwardToWhatsApp(msg) {
        try {
            // Find corresponding WhatsApp chat
            const whatsappJid = this.findWhatsAppJid(msg);
            if (!whatsappJid) {
                await this.telegramBot.sendMessage(msg.chat.id, '❌ No corresponding WhatsApp chat found.');
                return;
            }

            // Send message to WhatsApp
            await this.whatsappBot.sendMessage(whatsappJid, { text: msg.text });
            
            // Send confirmation
            await this.telegramBot.sendMessage(msg.chat.id, '✅ Message sent to WhatsApp');
            
        } catch (error) {
            logger.error('❌ Error forwarding to WhatsApp:', error);
            await this.telegramBot.sendMessage(msg.chat.id, `❌ Failed to send: ${error.message}`);
        }
    }

    findWhatsAppJid(telegramMsg) {
        // Logic to find corresponding WhatsApp JID based on topic or mapping
        for (const [jid, topicId] of this.topicMappings) {
            if (telegramMsg.message_thread_id === topicId) {
                return jid;
            }
        }
        return null;
    }

    async handleCallbackQuery(query) {
        const data = query.data;
        
        if (data.startsWith('contact_')) {
            const contactId = data.replace('contact_', '');
            await this.handleContactSelection(query, contactId);
        }
        
        await this.telegramBot.answerCallbackQuery(query.id);
    }

    async handleContactSelection(query, contactId) {
        const contact = this.contactMappings.get(contactId);
        if (contact) {
            const message = `📱 Selected Contact: ${contact}\n\nUse /send ${contactId} <message> to send a message.`;
            await this.telegramBot.editMessageText(message, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        }
    }

    async setupWhatsAppHandlers() {
        if (!this.whatsappBot?.sock) return;
        
        logger.info('🔗 Setting up WhatsApp event handlers for Telegram bridge');
        
        // We don't need to add new event listeners, just ensure our syncMessage method works
    }

    async syncMessage(msg, text) {
        if (!this.isInitialized || !this.telegramBot) return;
        
        try {
            // Check rate limiting
            if (!this.checkRateLimit(msg.key.remoteJid)) {
                return;
            }
            
            // Apply filters
            if (this.shouldFilterMessage(text)) {
                return;
            }
            
            // Queue message for processing
            this.messageQueue.push({ msg, text });
            
            if (!this.isProcessingQueue) {
                await this.processMessageQueue();
            }
            
        } catch (error) {
            logger.error('❌ Error syncing message to Telegram:', error);
            this.stats.errorsHandled++;
        }
    }

    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        try {
            while (this.messageQueue.length > 0) {
                const { msg, text } = this.messageQueue.shift();
                await this.processSingleMessage(msg, text);
                
                // Small delay to avoid overwhelming Telegram
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            logger.error('❌ Error processing message queue:', error);
        } finally {
            this.isProcessingQueue = false;
        }
    }

    async processSingleMessage(msg, text) {
        try {
            const isFromMe = msg.key.fromMe;
            const remoteJid = msg.key.remoteJid;
            const participant = msg.key.participant;
            
            // Skip own messages if configured
            if (isFromMe && !this.config.features.sendOutgoingMessages) {
                return;
            }
            
            // Get or create topic for this chat
            let topicId = this.topicMappings.get(remoteJid);
            if (!topicId && this.config.features.topics) {
                topicId = await this.createTopicForChat(remoteJid);
            }
            
            // Format message
            const formattedMessage = await this.formatMessage(msg, text);
            
            // Send to Telegram
            const sentMessage = await this.sendToTelegram(formattedMessage, topicId);
            
            // FIXED: Send read receipt after successful Telegram sync
            if (sentMessage && !isFromMe && this.config.features.readReceipts) {
                try {
                    await this.whatsappBot.sock.readMessages([msg.key]);
                    logger.debug('✅ Read receipt sent after Telegram sync');
                } catch (error) {
                    logger.debug('⚠️ Failed to send read receipt:', error.message);
                }
            }
            
            this.stats.messagesSynced++;
            
        } catch (error) {
            logger.error('❌ Error processing single message:', error);
            throw error;
        }
    }

    async formatMessage(msg, text) {
        const isFromMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const participant = msg.key.participant;
        const isGroup = remoteJid.endsWith('@g.us');
        
        let senderName = 'Unknown';
        let messageText = text || '';
        
        // Get sender information
        if (isFromMe) {
            senderName = '📱 You';
        } else if (isGroup && participant) {
            const contactName = this.contactMappings.get(participant.split('@')[0]);
            senderName = contactName || participant.split('@')[0];
        } else {
            const contactName = this.contactMappings.get(remoteJid.split('@')[0]);
            senderName = contactName || remoteJid.split('@')[0];
        }
        
        // Handle different message types
        if (msg.message?.imageMessage) {
            messageText = '📷 Image' + (msg.message.imageMessage.caption ? `: ${msg.message.imageMessage.caption}` : '');
            if (this.config.features.mediaSync) {
                await this.syncMedia(msg, 'image');
            }
        } else if (msg.message?.videoMessage) {
            messageText = '🎥 Video' + (msg.message.videoMessage.caption ? `: ${msg.message.videoMessage.caption}` : '');
            if (this.config.features.mediaSync) {
                await this.syncMedia(msg, 'video');
            }
        } else if (msg.message?.audioMessage) {
            messageText = msg.message.audioMessage.ptt ? '🎤 Voice Note' : '🎵 Audio';
            if (this.config.features.mediaSync) {
                await this.syncMedia(msg, 'audio');
            }
        } else if (msg.message?.documentMessage) {
            const fileName = msg.message.documentMessage.fileName || 'Document';
            messageText = `📄 ${fileName}`;
            if (this.config.features.mediaSync) {
                await this.syncMedia(msg, 'document');
            }
        } else if (msg.message?.stickerMessage) {
            messageText = '🎭 Sticker';
            if (this.config.features.animatedStickers) {
                await this.syncMedia(msg, 'sticker');
            }
        } else if (msg.message?.locationMessage) {
            const loc = msg.message.locationMessage;
            messageText = `📍 Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}`;
        } else if (msg.message?.contactMessage) {
            const contact = msg.message.contactMessage;
            messageText = `👤 Contact: ${contact.displayName}`;
        }
        
        // Format final message
        const timestamp = new Date().toLocaleTimeString();
        return `*${senderName}* [${timestamp}]\n${messageText}`;
    }

    async syncMedia(msg, mediaType) {
        try {
            const mediaMessage = msg.message[`${mediaType}Message`];
            if (!mediaMessage) return;
            
            // Download media
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            
            // Get topic ID
            const topicId = this.topicMappings.get(msg.key.remoteJid);
            
            // Send media to Telegram
            const options = {
                chat_id: this.config.chatId,
                ...(topicId && { message_thread_id: topicId })
            };
            
            switch (mediaType) {
                case 'image':
                    await this.telegramBot.sendPhoto(options.chat_id, buffer, {
                        caption: mediaMessage.caption || '',
                        message_thread_id: options.message_thread_id
                    });
                    break;
                case 'video':
                    await this.telegramBot.sendVideo(options.chat_id, buffer, {
                        caption: mediaMessage.caption || '',
                        message_thread_id: options.message_thread_id
                    });
                    break;
                case 'audio':
                    if (mediaMessage.ptt) {
                        await this.telegramBot.sendVoice(options.chat_id, buffer, {
                            message_thread_id: options.message_thread_id
                        });
                    } else {
                        await this.telegramBot.sendAudio(options.chat_id, buffer, {
                            message_thread_id: options.message_thread_id
                        });
                    }
                    break;
                case 'document':
                    await this.telegramBot.sendDocument(options.chat_id, buffer, {
                        message_thread_id: options.message_thread_id
                    }, {
                        filename: mediaMessage.fileName || 'document'
                    });
                    break;
                case 'sticker':
                    await this.telegramBot.sendSticker(options.chat_id, buffer, {
                        message_thread_id: options.message_thread_id
                    });
                    break;
            }
            
            this.stats.mediaProcessed++;
            
        } catch (error) {
            logger.error(`❌ Error syncing ${mediaType}:`, error);
        }
    }

    async createTopicForChat(remoteJid) {
        try {
            const isGroup = remoteJid.endsWith('@g.us');
            let topicName;
            
            if (isGroup) {
                // Get group metadata
                try {
                    const groupMetadata = await this.whatsappBot.sock.groupMetadata(remoteJid);
                    topicName = `📱 ${groupMetadata.subject}`;
                } catch (error) {
                    topicName = `📱 Group ${remoteJid.split('@')[0]}`;
                }
            } else {
                // Get contact name
                const contactName = this.contactMappings.get(remoteJid.split('@')[0]);
                topicName = `👤 ${contactName || remoteJid.split('@')[0]}`;
            }
            
            // Create forum topic
            const topic = await this.telegramBot.createForumTopic(this.config.chatId, topicName);
            const topicId = topic.message_thread_id;
            
            // Save mapping
            this.topicMappings.set(remoteJid, topicId);
            await this.saveMappingsToDb();
            
            // Send welcome message if configured
            if (this.config.features.welcomeMessage) {
                const welcomeText = `🎉 *New Chat Topic Created*\n\n` +
                    `📱 WhatsApp: ${topicName}\n` +
                    `🆔 JID: \`${remoteJid}\`\n` +
                    `📅 Created: ${new Date().toLocaleString()}`;
                
                await this.telegramBot.sendMessage(this.config.chatId, welcomeText, {
                    message_thread_id: topicId,
                    parse_mode: 'Markdown'
                });
            }
            
            logger.info(`✅ Created topic for ${remoteJid}: ${topicName}`);
            return topicId;
            
        } catch (error) {
            logger.error(`❌ Error creating topic for ${remoteJid}:`, error);
            return null;
        }
    }

    async sendToTelegram(message, topicId = null) {
        try {
            const options = {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            };
            
            if (topicId) {
                options.message_thread_id = topicId;
            }
            
            return await this.telegramBot.sendMessage(this.config.chatId, message, options);
            
        } catch (error) {
            logger.error('❌ Error sending to Telegram:', error);
            throw error;
        }
    }

    checkRateLimit(jid) {
        const now = Date.now();
        const key = jid;
        
        if (!this.rateLimiter.messages.has(key)) {
            this.rateLimiter.messages.set(key, []);
        }
        
        const timestamps = this.rateLimiter.messages.get(key);
        const recentMessages = timestamps.filter(t => now - t < 60000);
        
        if (recentMessages.length >= this.rateLimiter.maxPerMinute) {
            return false;
        }
        
        recentMessages.push(now);
        this.rateLimiter.messages.set(key, recentMessages);
        return true;
    }

    shouldFilterMessage(text) {
        if (!text || this.filters.size === 0) return false;
        
        const lowerText = text.toLowerCase();
        for (const filter of this.filters) {
            if (lowerText.startsWith(filter.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    async syncContacts() {
        try {
            if (!this.whatsappBot?.sock) {
                throw new Error('WhatsApp not connected');
            }
            
            // Get contacts from WhatsApp store if available
            const contacts = this.whatsappBot.store?.contacts || {};
            
            let syncedCount = 0;
            for (const [jid, contact] of Object.entries(contacts)) {
                if (contact.name || contact.notify) {
                    const phoneNumber = jid.split('@')[0];
                    const name = contact.name || contact.notify || contact.verifiedName;
                    
                    if (name && phoneNumber) {
                        this.contactMappings.set(phoneNumber, name);
                        syncedCount++;
                    }
                }
            }
            
            logger.info(`✅ Synced ${syncedCount} contacts from WhatsApp`);
            return syncedCount;
            
        } catch (error) {
            logger.error('❌ Error syncing contacts:', error);
            throw error;
        }
    }

    async syncWhatsAppConnection() {
        if (!this.whatsappBot?.sock?.user) return;
        
        const user = this.whatsappBot.sock.user;
        const message = `🔗 *WhatsApp Connected*\n\n` +
            `👤 User: ${user.name || 'Unknown'}\n` +
            `📱 Number: ${user.id.split(':')[0]}\n` +
            `🕐 Connected: ${new Date().toLocaleString()}\n` +
            `📊 Bridge Status: Active`;
        
        await this.logToTelegram('WhatsApp Connection', message);
    }

    async logToTelegram(title, message) {
        try {
            const logChannelId = this.config.logChannel || this.config.chatId;
            const logMessage = `📋 *${title}*\n\n${message}`;
            
            await this.telegramBot.sendMessage(logChannelId, logMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            
        } catch (error) {
            logger.error('❌ Error logging to Telegram:', error);
        }
    }

    async sendStartMessage() {
        const message = `🚀 *Telegram Bridge Started*\n\n` +
            `✅ Bot initialized successfully\n` +
            `🔗 Ready to sync WhatsApp messages\n` +
            `📅 Started: ${new Date().toLocaleString()}\n\n` +
            `Use /start to see available commands.`;
        
        await this.logToTelegram('Bridge Status', message);
    }

    async sendQRCode(qr) {
        try {
            const QRCode = require('qrcode');
            const qrBuffer = await QRCode.toBuffer(qr, { type: 'png', width: 512 });
            
            await this.telegramBot.sendPhoto(this.config.chatId, qrBuffer, {
                caption: '📱 *WhatsApp QR Code*\n\nScan this QR code with WhatsApp to connect.',
                parse_mode: 'Markdown'
            });
            
        } catch (error) {
            logger.error('❌ Error sending QR code to Telegram:', error);
            
            // Fallback: send QR as text
            await this.telegramBot.sendMessage(this.config.chatId, 
                `📱 *WhatsApp QR Code*\n\n\`\`\`\n${qr}\n\`\`\`\n\nScan this QR code with WhatsApp to connect.`,
                { parse_mode: 'Markdown' }
            );
        }
    }

    // Filter management
    async addFilter(word) {
        this.filters.add(word.toLowerCase());
        await this.saveFiltersToDb();
    }

    async removeFilter(word) {
        this.filters.delete(word.toLowerCase());
        await this.saveFiltersToDb();
    }

    async clearFilters() {
        this.filters.clear();
        await this.saveFiltersToDb();
    }

    // Database operations
    async loadMappingsFromDb() {
        try {
            const collection = this.db.collection('telegram_bridge');
            
            const mappings = await collection.findOne({ type: 'mappings' });
            if (mappings) {
                this.chatMappings = new Map(mappings.chatMappings || []);
                this.contactMappings = new Map(mappings.contactMappings || []);
                this.userMappings = new Map(mappings.userMappings || []);
                this.topicMappings = new Map(mappings.topicMappings || []);
            }
            
        } catch (error) {
            logger.error('❌ Error loading mappings from database:', error);
        }
    }

    async saveMappingsToDb() {
        try {
            const collection = this.db.collection('telegram_bridge');
            
            await collection.updateOne(
                { type: 'mappings' },
                {
                    $set: {
                        chatMappings: Array.from(this.chatMappings.entries()),
                        contactMappings: Array.from(this.contactMappings.entries()),
                        userMappings: Array.from(this.userMappings.entries()),
                        topicMappings: Array.from(this.topicMappings.entries()),
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
            
        } catch (error) {
            logger.error('❌ Error saving mappings to database:', error);
        }
    }

    async loadFiltersFromDb() {
        try {
            const collection = this.db.collection('telegram_bridge');
            
            const filtersDoc = await collection.findOne({ type: 'filters' });
            if (filtersDoc && filtersDoc.filters) {
                this.filters = new Set(filtersDoc.filters);
            }
            
        } catch (error) {
            logger.error('❌ Error loading filters from database:', error);
        }
    }

    async saveFiltersToDb() {
        try {
            const collection = this.db.collection('telegram_bridge');
            
            await collection.updateOne(
                { type: 'filters' },
                {
                    $set: {
                        filters: Array.from(this.filters),
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
            
        } catch (error) {
            logger.error('❌ Error saving filters to database:', error);
        }
    }

    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        return {
            ...this.stats,
            uptime,
            chatsTracked: this.chatMappings.size,
            contactsTracked: this.contactMappings.size,
            topicsCreated: this.topicMappings.size,
            filtersActive: this.filters.size
        };
    }

    async shutdown() {
        logger.info('🛑 Shutting down Telegram bridge...');
        
        try {
            // Save current state
            await this.saveMappingsToDb();
            await this.saveFiltersToDb();
            
            // Stop Telegram bot
            if (this.telegramBot) {
                await this.telegramBot.stopPolling();
            }
            
            // Send shutdown message
            await this.logToTelegram('Bridge Status', '🛑 Telegram bridge shutting down...');
            
            this.isInitialized = false;
            logger.info('✅ Telegram bridge shutdown complete');
            
        } catch (error) {
            logger.error('❌ Error during Telegram bridge shutdown:', error);
        }
    }
}

module.exports = TelegramBridge;