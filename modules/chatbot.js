const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const config = require('../config');
const logger = require('../Core/logger');

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

        // Chatbot state
        this.globalChatEnabled = false;
        this.userChatSettings = new Map(); // userId -> enabled/disabled
        this.groupChatSettings = new Map(); // groupId -> enabled/disabled
        this.conversations = new Map(); // userId/groupId -> conversation history
        this.maxConversationLength = 20;

        // Bot personality and role
        this.botPersonality = `You are HyperWa, an advanced AI assistant integrated into a WhatsApp bot. You are:
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
                description: 'Set bot personality (owner only)',
                usage: '.setpersonality <personality_description>',
                permissions: 'owner',
                ui: {
                    processingText: '⏳ *Setting Personality...*\n\n🤖 Updating AI personality...',
                    errorText: '❌ *Personality Update Failed*'
                },
                execute: this.setPersonality.bind(this)
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

            logger.info('✅ ChatBot module initialized with Gemini 2.0 Flash');
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
            const hadConversation = this.conversations.has(conversationId);
            
            this.conversations.delete(conversationId);

            if (hadConversation) {
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
                return `🤖 *Current Personality:*\n\n${this.botPersonality}\n\n💡 **Usage:** \`.setpersonality <new_personality_description>\``;
            }

            const newPersonality = params.join(' ').trim();
            if (newPersonality.length < 10) {
                return '❌ *Personality Too Short*\n\nPlease provide a more detailed personality description (at least 10 characters).';
            }

            this.botPersonality = newPersonality;
            
            return `🤖 *Personality Updated Successfully!*\n\n**New Personality:** ${newPersonality.substring(0, 100)}${newPersonality.length > 100 ? '...' : ''}\n\nTry chatting with me to see the difference! ✨`;
        } catch (error) {
            logger.error('Error in setPersonality:', error);
            return '❌ Failed to update personality. Please try again.';
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
                   `• \`.setpersonality\` - Change AI personality (owner)\n\n` +
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
            const history = this.getConversationHistory(conversationId);
            
            // Build context-aware prompt
            let prompt = this.botPersonality + '\n\n';
            
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

            // Update conversation history
            this.addToConversation(conversationId, text, aiResponse);

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

    getConversationHistory(conversationId) {
        if (!this.conversations.has(conversationId)) {
            this.conversations.set(conversationId, []);
        }
        return this.conversations.get(conversationId);
    }

    addToConversation(conversationId, userMessage, aiResponse) {
        const history = this.getConversationHistory(conversationId);
        
        history.push({
            user: userMessage,
            assistant: aiResponse,
            timestamp: Date.now()
        });

        // Keep only recent messages
        if (history.length > this.maxConversationLength) {
            history.shift();
        }
    }


}

module.exports = ChatBotModule;
