const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const config = require('../config');
const logger = require('../Core/logger');
const Database = require('../utils/db');

class ChatBotModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'chatbot';
        this.metadata = {
            description: 'Advanced chatbot with Gemini AI, conversation memory, and per-user/group settings',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'ai'
        };

        // Gemini API configuration
        this.apiKey = "AIzaSyC1-5hrYIdfNsg2B7bcb5Qs3ib1MIWlbOE"; // Consider moving to config
        this.genAI = null;
        this.model = null;

        // Database configuration
        this.db = null;
        this.collection = null;

        // Chatbot state
        this.globalChatEnabled = false;
        this.userChatSettings = new Map(); // userId -> enabled/disabled
        this.groupChatSettings = new Map(); // groupId -> enabled/disabled
        this.conversations = new Map(); // userId/groupId -> conversation history
        this.maxConversationLength = 20;

        // Bot default role (renamed from personality)
        this.defaultRole = `You are HyperWa, an advanced AI assistant integrated into a WhatsApp bot. You are:
- Helpful, friendly, and knowledgeable
- Capable of understanding context and maintaining conversations
- Able to assist with various tasks and questions
- Integrated with multiple bot modules and features
- Smart and witty, but professional
- Always ready to help users with their needs

Keep responses concise but informative. Use emojis appropriately. Be engaging and personable.`;

        this.commands = [
            {
                name: 'chat',
                description: 'Toggle chatbot for user/group or globally',
                usage: '.chat on/off [user_number] OR .chat on/off (in group)',
                aliases: ['c'],
                permissions: 'admin',
                ui: {
                    processingText: '⏳ *Processing Chat Toggle...*\n\n🔄 Updating settings...',
                    errorText: '❌ *Chat Toggle Failed*'
                },
                execute: this.toggleChat.bind(this)
            },
            {
                name: 'chatall',
                description: 'Toggle global chatbot for all users',
                usage: '.chatall on/off',
                permissions: 'owner',
                ui: {
                    processingText: '⏳ *Processing Global Chat...*\n\n🌐 Updating global settings...',
                    errorText: '❌ *Global Chat Toggle Failed*'
                },
                execute: this.toggleGlobalChat.bind(this)
            },
            {
                name: 'groupchat',
                description: 'Toggle chatbot for current group',
                usage: '.groupchat on/off',
                aliases: ['gc'],
                permissions: 'admin',
                ui: {
                    processingText: '⏳ *Processing Group Chat...*\n\n👥 Updating group settings...',
                    errorText: '❌ *Group Chat Toggle Failed*'
                },
                execute: this.toggleGroupChat.bind(this)
            },
            {
                name: 'chatstatus',
                description: 'Check chatbot status',
                usage: '.chatstatus',
                permissions: 'public',
                ui: {
                    processingText: '⏳ *Checking Status...*\n\n📊 Gathering information...',
                    errorText: '❌ *Status Check Failed*'
                },
                execute: this.getChatStatus.bind(this)
            },
            {
                name: 'clearchat',
                description: 'Clear conversation history',
                usage: '.clearchat',
                permissions: 'public',
                ui: {
                    processingText: '⏳ *Clearing Chat...*\n\n🧹 Removing conversation history...',
                    errorText: '❌ *Clear Chat Failed*'
                },
                execute: this.clearConversation.bind(this)
            },
            {
                name: 'setpersonality',
                description: 'Set bot personality/role (owner only)',
                usage: '.setpersonality <personality_description>',
                aliases: ['setp'],
                permissions: 'owner',
                ui: {
                    processingText: '⏳ *Setting Global Personality...*\n\n🤖 Updating AI personality...',
                    errorText: '❌ *Personality Update Failed*'
                },
                execute: this.setPersonality.bind(this)
            },
            {
                name: 'setrole',
                description: 'Set bot role for yourself or group',
                usage: '.setrole <role_description>',
                aliases: ['role'],
                permissions: 'public',
                ui: {
                    processingText: '⏳ *Setting Personal Role...*\n\n🎭 Updating your custom role...',
                    errorText: '❌ *Role Update Failed*'
                },
                execute: this.setPersonalRole.bind(this)
            },
            {
                name: 'resetrole',
                description: 'Reset to default role',
                usage: '.resetrole',
                aliases: ['rr'],
                permissions: 'public',
                ui: {
                    processingText: '⏳ *Resetting Role...*\n\n🔄 Restoring default role...',
                    errorText: '❌ *Role Reset Failed*'
                },
                execute: this.resetPersonalRole.bind(this)
            },
            {
                name: 'myrole',
                description: 'Show your current role',
                usage: '.myrole',
                permissions: 'public',
                ui: {
                    processingText: '⏳ *Checking Role...*\n\n👤 Getting your role info...',
                    errorText: '❌ *Role Check Failed*'
                },
                execute: this.showPersonalRole.bind(this)
            },
            {
                name: 'chathelp',
                description: 'Show chatbot help and features',
                usage: '.chathelp',
                permissions: 'public',
                ui: {
                    processingText: '⏳ *Loading Help...*\n\n📚 Preparing help information...',
                    errorText: '❌ *Help Load Failed*'
                },
                execute: this.showChatHelp.bind(this)
            }
        ];

        // Message hooks for chat processing
        this.messageHooks = {
            'pre_process': this.handleChatMessage.bind(this)
        };
    }

    async init() {
        try {
            // Initialize database
            this.db = this.bot.db;
            this.collection = this.db.collection('chatbot_data');
            
            // Create indexes for better performance
            await this.collection.createIndex({ userId: 1 });
            await this.collection.createIndex({ groupId: 1 });
            await this.collection.createIndex({ conversationId: 1 });
            
            if (!this.apiKey || this.apiKey === "YOUR_GEMINI_API_KEY") {
                logger.error('❌ Gemini API key is missing for ChatBot module');
                throw new Error('Gemini API key not configured');
            }

            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.model = this.genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash",
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ]
            });

            logger.info('✅ ChatBot module initialized with Gemini 2.0 Flash and Database');
        } catch (error) {
            logger.error('❌ Failed to initialize ChatBot module:', error);
            throw error;
        }
    }

    async toggleChat(msg, params, context) {
        try {
            const action = params[0]?.toLowerCase();
            const targetUser = params[1];

            if (!action || !['on', 'off'].includes(action)) {
                return await this.getChatStatus(msg, params, context);
            }

            const isGroup = context.sender.endsWith('@g.us');
            const enabled = action === 'on';

            if (targetUser) {
                // Toggle for specific user
                const userId = targetUser.replace(/[^\d]/g, '');
                if (!userId) {
                    return '❌ Invalid user number format.\n\nPlease provide a valid phone number.';
                }

                this.userChatSettings.set(userId, enabled);
                return `💬 *Chat ${enabled ? 'Enabled' : 'Disabled'}*\n\nUser: +${userId}\nStatus: ${enabled ? '✅ Active' : '❌ Inactive'}`;

            } else if (isGroup) {
                // Toggle for current group
                this.groupChatSettings.set(context.sender, enabled);
                return `💬 *Group Chat ${enabled ? 'Enabled' : 'Disabled'}*\n\n${enabled ? 'I\'ll now respond to messages in this group! 🎉' : 'I\'ll stop responding to messages in this group. 😴'}`;

            } else {
                // Toggle for current user
                const userId = context.participant.split('@')[0];
                this.userChatSettings.set(userId, enabled);
                return `💬 *Chat ${enabled ? 'Enabled' : 'Disabled'}*\n\n${enabled ? 'I\'ll now respond to your messages! 🎉' : 'I\'ll stop responding to your messages. 😴'}`;
            }
        } catch (error) {
            logger.error('Error in toggleChat:', error);
            return '❌ Failed to toggle chat settings. Please try again.';
        }
    }

    async toggleGlobalChat(msg, params, context) {
        try {
            const action = params[0]?.toLowerCase();

            if (!action || !['on', 'off'].includes(action)) {
                return `🌐 *Global Chat Status*\n\nCurrent: ${this.globalChatEnabled ? '✅ ENABLED' : '❌ DISABLED'}\n\n💡 Usage: \`.chatall on/off\``;
            }

            this.globalChatEnabled = action === 'on';

            return `🌐 *Global Chat ${this.globalChatEnabled ? 'Enabled' : 'Disabled'}*\n\n` +
                   `${this.globalChatEnabled ? 'I\'ll now respond to all users by default! 🌟' : 'Global chat disabled. Individual settings will be used. ⚙️'}`;
        } catch (error) {
            logger.error('Error in toggleGlobalChat:', error);
            return '❌ Failed to toggle global chat. Please try again.';
        }
    }

    async toggleGroupChat(msg, params, context) {
        try {
            if (!context.sender.endsWith('@g.us')) {
                return '❌ *Group Only Command*\n\nThis command can only be used in group chats.';
            }

            const action = params[0]?.toLowerCase();

            if (!action || !['on', 'off'].includes(action)) {
                const currentStatus = this.groupChatSettings.get(context.sender) || false;
                return `👥 *Group Chat Status*\n\nCurrent: ${currentStatus ? '✅ ENABLED' : '❌ DISABLED'}\n\n💡 Usage: \`.groupchat on/off\``;
            }

            const enabled = action === 'on';
            this.groupChatSettings.set(context.sender, enabled);

            return `👥 *Group Chat ${enabled ? 'Enabled' : 'Disabled'}*\n\n` +
                   `${enabled ? 'I\'ll now participate in group conversations! 🎉' : 'I\'ll stop responding in this group. 😴'}`;
        } catch (error) {
            logger.error('Error in toggleGroupChat:', error);
            return '❌ Failed to toggle group chat. Please try again.';
        }
    }

    async getChatStatus(msg, params, context) {
        try {
            const isGroup = context.sender.endsWith('@g.us');
            const userId = context.participant.split('@')[0];

            let status = `💬 *ChatBot Status Report*\n\n`;
            status += `🌐 Global Chat: ${this.globalChatEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;

            if (isGroup) {
                const groupEnabled = this.groupChatSettings.get(context.sender) || false;
                status += `👥 This Group: ${groupEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
            }

            const userEnabled = this.userChatSettings.get(userId);
            const userStatus = userEnabled !== undefined ? userEnabled : this.globalChatEnabled;
            status += `👤 Your Chat: ${userStatus ? '✅ Enabled' : '❌ Disabled'}\n`;

            status += `\n📊 *Statistics:*\n`;
            status += `• Active Users: ${[...this.userChatSettings.values()].filter(Boolean).length}\n`;
            status += `• Active Groups: ${[...this.groupChatSettings.values()].filter(Boolean).length}\n`;
            status += `• Active Conversations: ${this.conversations.size}\n`;

            const willRespond = this.shouldRespondToChat(context);
            status += `\n🤖 *Will I respond to you?* ${willRespond ? '✅ Yes' : '❌ No'}`;

            return status;
        } catch (error) {
            logger.error('Error in getChatStatus:', error);
            return '❌ Failed to get chat status. Please try again.';
        }
    }

    async clearConversation(msg, params, context) {
        try {
            const conversationId = this.getConversationId(context);
            const result = await this.collection.deleteOne({ conversationId });
            
            if (result.deletedCount > 0) {
                return `🧹 *Conversation Cleared Successfully*\n\nYour chat history has been reset. Starting fresh! 🌟`;
            } else {
                return `🧹 *No Conversation Found*\n\nThere was no existing conversation history to clear. Ready for a fresh start! 🌟`;
            }
        } catch (error) {
            logger.error('Error in clearConversation:', error);
            return '❌ Failed to clear conversation. Please try again.';
        }
    }

    async setPersonality(msg, params, context) {
        try {
            if (params.length === 0) {
                return `🤖 *Current Global Role:*\n\n${this.defaultRole}\n\n💡 **Usage:** \`.setpersonality <new_role_description>\`\n\n⚠️ This changes the global default role for all users.`;
            }

            const newRole = params.join(' ').trim();
            if (newRole.length < 10) {
                return '❌ *Role Too Short*\n\nPlease provide a more detailed role description (at least 10 characters).';
            }

            this.defaultRole = newRole;
            
            return `🤖 *Global Role Updated Successfully!*\n\n**New Default Role:** ${newRole.substring(0, 100)}${newRole.length > 100 ? '...' : ''}\n\nThis affects all users who haven't set a personal role. ✨`;
        } catch (error) {
            logger.error('Error in setPersonality:', error);
            return '❌ Failed to update global role. Please try again.';
        }
    }

    async setPersonalRole(msg, params, context) {
        try {
            if (params.length === 0) {
                return `🎭 *Set Personal Role*\n\n💡 **Usage:** \`.setrole <role_description>\`\n\n**Examples:**\n• \`.setrole You are a coding assistant\`\n• \`.setrole You are a creative writing helper\`\n• \`.setrole You are a math tutor\`\n\nThis sets a custom role just for you!`;
            }

            const newRole = params.join(' ').trim();
            if (newRole.length < 10) {
                return '❌ *Role Too Short*\n\nPlease provide a more detailed role description (at least 10 characters).';
            }

            const userId = context.participant.split('@')[0];
            const isGroup = context.sender.endsWith('@g.us');
            const targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;

            // Save to database
            await this.savePersonalRole(targetId, newRole);
            
            const scopeText = isGroup ? 'this group' : 'you';
            return `🎭 *Personal Role Set Successfully!*\n\n**Your Custom Role:** ${newRole.substring(0, 150)}${newRole.length > 150 ? '...' : ''}\n\nI'll use this role when chatting with ${scopeText}! ✨`;
        } catch (error) {
            logger.error('Error in setPersonalRole:', error);
            return '❌ Failed to set personal role. Please try again.';
        }
    }

    async resetPersonalRole(msg, params, context) {
        try {
            const userId = context.participant.split('@')[0];
            const isGroup = context.sender.endsWith('@g.us');
            const targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;

            // Remove from database
            await this.removePersonalRole(targetId);
            
            const scopeText = isGroup ? 'this group' : 'you';
            return `🔄 *Role Reset Successfully!*\n\nI'll now use the default role when chatting with ${scopeText}.\n\n**Default Role:** ${this.defaultRole.substring(0, 100)}${this.defaultRole.length > 100 ? '...' : ''}`;
        } catch (error) {
            logger.error('Error in resetPersonalRole:', error);
            return '❌ Failed to reset role. Please try again.';
        }
    }

    async showPersonalRole(msg, params, context) {
        try {
            const userId = context.participant.split('@')[0];
            const isGroup = context.sender.endsWith('@g.us');
            const targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;

            const personalRole = await this.getPersonalRole(targetId);
            const scopeText = isGroup ? 'this group' : 'you';
            
            if (personalRole) {
                return `🎭 *Your Current Role*\n\n**Custom Role for ${scopeText}:**\n${personalRole}\n\n💡 Use \`.resetrole\` to return to default.`;
            } else {
                return `🤖 *Current Role for ${scopeText}*\n\n**Using Default Role:**\n${this.defaultRole}\n\n💡 Use \`.setrole <description>\` to set a custom role.`;
            }
        } catch (error) {
            logger.error('Error in showPersonalRole:', error);
            return '❌ Failed to get role information. Please try again.';
        }
    }

    async showChatHelp(msg, params, context) {
        try {
            return `💬 *ChatBot Help & Features*\n\n` +
                   `🤖 **What I can do:**\n` +
                   `• Have natural conversations\n` +
                   `• Remember our chat history (${this.maxConversationLength} messages)\n` +
                   `• Answer questions on any topic\n` +
                   `• Help with tasks and problems\n` +
                   `• Provide information and explanations\n` +
                   `• Be your AI companion! 🌟\n\n` +
                   `⚙️ **Commands:**\n` +
                   `• \`.chat on/off\` - Toggle for you/group\n` +
                   `• \`.chatstatus\` - Check current status\n` +
                   `• \`.clearchat\` - Clear conversation history\n` +
                   `• \`.chathelp\` - Show this help\n` +
                   `• \`.chatall on/off\` - Global toggle (owner only)\n` +
                   `• \`.groupchat on/off\` - Group toggle (admin)\n` +
                   `• \`.setrole <description>\` - Set custom role for you/group\n` +
                   `• \`.myrole\` - Show your current role\n` +
                   `• \`.resetrole\` - Reset to default role\n` +
                   `• \`.setpersonality\` - Change global role (owner)\n\n` +
                   `💡 **Tips:**\n` +
                   `• Just type normally to chat with me\n` +
                   `• I remember our conversation context\n` +
                   `• Ask me anything - I'm here to help!\n` +
                   `• Use commands to control my behavior\n\n` +
                   `🚀 Ready to chat? Just send me a message!`;
        } catch (error) {
            logger.error('Error in showChatHelp:', error);
            return '❌ Failed to load help information. Please try again.';
        }
    }

    async handleChatMessage(msg, text, bot) {
        // Skip if no text or it's a command
        if (!text || text.startsWith(config.get('bot.prefix'))) return;

        const context = {
            sender: msg.key.remoteJid,
            participant: msg.key.participant || msg.key.remoteJid,
            isGroup: msg.key.remoteJid.endsWith('@g.us'),
            fromMe: msg.key.fromMe
        };

        // Skip own messages
        if (context.fromMe) return;

        // Check if chat is enabled for this user/group
        if (!this.shouldRespondToChat(context)) return;

        try {
            // Generate AI response
            const response = await this.generateChatResponse(text, context);
            
            if (response) {
                // Add typing indicator
                await bot.sock.presenceSubscribe(context.sender);
                await bot.sock.sendPresenceUpdate('composing', context.sender);
                
                // Simulate typing delay
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
                
                await bot.sock.sendPresenceUpdate('paused', context.sender);
                
                // Send response
                await bot.sendMessage(context.sender, { text: response });
            }

        } catch (error) {
            logger.error('ChatBot response error:', error);
        }
    }

    shouldRespondToChat(context) {
        const userId = context.participant.split('@')[0];

        // Check global setting first
        if (this.globalChatEnabled) {
            // Check if specifically disabled for this user/group
            if (context.isGroup) {
                return this.groupChatSettings.get(context.sender) !== false;
            } else {
                return this.userChatSettings.get(userId) !== false;
            }
        } else {
            // Check if specifically enabled for this user/group
            if (context.isGroup) {
                return this.groupChatSettings.get(context.sender) === true;
            } else {
                return this.userChatSettings.get(userId) === true;
            }
        }
    }

    async generateChatResponse(text, context) {
        try {
            const conversationId = this.getConversationId(context);
            const history = await this.getConversationHistory(conversationId);
            
            // Get the appropriate role (personal or default)
            const userId = context.participant.split('@')[0];
            const isGroup = context.isGroup;
            const targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;
            const personalRole = await this.getPersonalRole(targetId);
            const currentRole = personalRole || this.defaultRole;
            
            // Build context-aware prompt
            let prompt = currentRole + '\n\n';
            
            // Add conversation history
            if (history.length > 0) {
                prompt += 'Previous conversation:\n';
                history.forEach(entry => {
                    prompt += `User: ${entry.user}\nAssistant: ${entry.assistant}\n\n`;
                });
            }
            
            // Add current message
            prompt += `Current message: ${text}\n\n`;
            prompt += 'Respond naturally and helpfully. Keep it conversational and engaging.';

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const aiResponse = response.text();

            // Update conversation history in database
            await this.addToConversation(conversationId, text, aiResponse);

            return aiResponse;

        } catch (error) {
            logger.error('Error generating chat response:', error);
            return '❌ Sorry, I encountered an error generating a response. Please try again.';
        }
    }

    getConversationId(context) {
        if (context.isGroup) {
            return `group_${context.sender}`;
        } else {
            return `user_${context.participant.split('@')[0]}`;
        }
    }

    async getConversationHistory(conversationId) {
        try {
            const data = await this.collection.findOne({ conversationId });
            return data ? data.history : [];
        } catch (error) {
            logger.error('Error getting conversation history:', error);
            return [];
        }
    }

    async addToConversation(conversationId, userMessage, aiResponse) {
        try {
            const data = await this.collection.findOne({ conversationId });
            let history = data ? data.history : [];
            
            history.push({
                user: userMessage,
                assistant: aiResponse,
                timestamp: Date.now()
            });

            // Keep only recent messages
            if (history.length > this.maxConversationLength) {
                history = history.slice(-this.maxConversationLength);
            }

            await this.collection.updateOne(
                { conversationId },
                { 
                    $set: { 
                        history, 
                        updatedAt: new Date() 
                    } 
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error adding to conversation:', error);
        }
    }

    // Database helper methods for personal roles
    async savePersonalRole(targetId, role) {
        try {
            await this.collection.updateOne(
                { targetId, type: 'personalRole' },
                { 
                    $set: { 
                        role, 
                        updatedAt: new Date() 
                    } 
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error saving personal role:', error);
            throw error;
        }
    }

    async getPersonalRole(targetId) {
        try {
            const data = await this.collection.findOne({ targetId, type: 'personalRole' });
            return data ? data.role : null;
        } catch (error) {
            logger.error('Error getting personal role:', error);
            return null;
        }
    }

    async removePersonalRole(targetId) {
        try {
            await this.collection.deleteOne({ targetId, type: 'personalRole' });
        } catch (error) {
            logger.error('Error removing personal role:', error);
            throw error;
        }
    }

    // Optional: Cleanup on unload
    async destroy() {
        logger.info('ChatBot module destroyed');
    }
}

module.exports = ChatBotModule;
