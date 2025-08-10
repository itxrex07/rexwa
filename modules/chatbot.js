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
        this.apiKey = "AIzaSyC1-5hrYIdfNsg2B7bcb5Qs3ib1MIWlbOE";
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
                execute: this.toggleChat.bind(this)
            },
            {
                name: 'chatall',
                description: 'Toggle global chatbot for all users',
                usage: '.chatall on/off',
                permissions: 'owner',
                execute: this.toggleGlobalChat.bind(this)
            },
            {
                name: 'groupchat',
                description: 'Toggle chatbot for current group',
                usage: '.groupchat on/off',
                permissions: 'admin',
                execute: this.toggleGroupChat.bind(this)
            },
            {
                name: 'chatstatus',
                description: 'Check chatbot status',
                usage: '.chatstatus',
                permissions: 'public',
                execute: this.getChatStatus.bind(this)
            },
            {
                name: 'clearchat',
                description: 'Clear conversation history',
                usage: '.clearchat',
                permissions: 'public',
                execute: this.clearConversation.bind(this)
            },
            {
                name: 'setpersonality',
                description: 'Set bot personality (owner only)',
                usage: '.setpersonality <personality_description>',
                permissions: 'owner',
                execute: this.setPersonality.bind(this)
            },
            {
                name: 'chathelp',
                description: 'Show chatbot help and features',
                usage: '.chathelp',
                permissions: 'public',
                execute: this.showChatHelp.bind(this)
            }
        ];

        // Message hooks for chat processing
        this.messageHooks = {
            'pre_process': this.handleChatMessage.bind(this)
        };
    }

    async init() {
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
    }

    async toggleChat(msg, params, context) {
        const action = params[0]?.toLowerCase();
        const targetUser = params[1];

        if (!action || !['on', 'off'].includes(action)) {
            return this.getChatStatus(msg, params, context);
        }

        const isGroup = context.sender.endsWith('@g.us');
        const enabled = action === 'on';

        if (targetUser) {
            // Toggle for specific user
            const userId = targetUser.replace(/[^\d]/g, '');
            if (!userId) {
                return '❌ Invalid user number format.';
            }

            this.userChatSettings.set(userId, enabled);
            return `💬 *Chat ${enabled ? 'Enabled' : 'Disabled'}* for user +${userId}`;

        } else if (isGroup) {
            // Toggle for current group
            this.groupChatSettings.set(context.sender, enabled);
            return `💬 *Group Chat ${enabled ? 'Enabled' : 'Disabled'}*\n\n${enabled ? 'I\'ll now respond to messages in this group!' : 'I\'ll stop responding to messages in this group.'}`;

        } else {
            // Toggle for current user
            const userId = context.participant.split('@')[0];
            this.userChatSettings.set(userId, enabled);
            return `💬 *Chat ${enabled ? 'Enabled' : 'Disabled'}* for you\n\n${enabled ? 'I\'ll now respond to your messages!' : 'I\'ll stop responding to your messages.'}`;
        }
    }

    async toggleGlobalChat(msg, params, context) {
        const action = params[0]?.toLowerCase();

        if (!action || !['on', 'off'].includes(action)) {
            return `🌐 *Global Chat: ${this.globalChatEnabled ? '✅ ON' : '❌ OFF'}*\n\nUsage: .chatall on/off`;
        }

        this.globalChatEnabled = action === 'on';

        return `🌐 *Global Chat ${this.globalChatEnabled ? 'Enabled' : 'Disabled'}*\n\n` +
               `${this.globalChatEnabled ? 'I\'ll now respond to all users by default!' : 'Global chat disabled. Use individual settings.'}`;
    }

    async toggleGroupChat(msg, params, context) {
        const action = params[0]?.toLowerCase();

        if (!context.sender.endsWith('@g.us')) {
            return '❌ This command can only be used in groups.';
        }

        if (!action || !['on', 'off'].includes(action)) {
            const currentStatus = this.groupChatSettings.get(context.sender) || false;
            return `👥 *Group Chat: ${currentStatus ? '✅ ON' : '❌ OFF'}*\n\nUsage: .groupchat on/off`;
        }

        const enabled = action === 'on';
        this.groupChatSettings.set(context.sender, enabled);

        return `👥 *Group Chat ${enabled ? 'Enabled' : 'Disabled'}*\n\n` +
               `${enabled ? 'I\'ll now participate in group conversations!' : 'I\'ll stop responding in this group.'}`;
    }

    async getChatStatus(msg, params, context) {
        const isGroup = context.sender.endsWith('@g.us');
        const userId = context.participant.split('@')[0];

        let status = `💬 *ChatBot Status*\n\n`;
        status += `🌐 Global Chat: ${this.globalChatEnabled ? '✅' : '❌'}\n`;

        if (isGroup) {
            const groupEnabled = this.groupChatSettings.get(context.sender) || false;
            status += `👥 This Group: ${groupEnabled ? '✅' : '❌'}\n`;
        }

        const userEnabled = this.userChatSettings.get(userId);
        const userStatus = userEnabled !== undefined ? userEnabled : this.globalChatEnabled;
        status += `👤 Your Chat: ${userStatus ? '✅' : '❌'}\n`;

        status += `\n📊 *Statistics:*\n`;
        status += `• Active Users: ${[...this.userChatSettings.values()].filter(Boolean).length}\n`;
        status += `• Active Groups: ${[...this.groupChatSettings.values()].filter(Boolean).length}\n`;
        status += `• Conversations: ${this.conversations.size}\n`;

        return status;
    }

    async clearConversation(msg, params, context) {
        const conversationId = this.getConversationId(context);
        this.conversations.delete(conversationId);

        return `🧹 *Conversation Cleared*\n\nYour chat history has been reset. Starting fresh! 🌟`;
    }

    async setPersonality(msg, params, context) {
        if (params.length === 0) {
            return `🤖 *Current Personality:*\n\n${this.botPersonality}\n\n💡 Usage: .setpersonality <new_personality>`;
        }

        this.botPersonality = params.join(' ');
        
        return `🤖 *Personality Updated!*\n\nI've adopted a new personality. Try chatting with me to see the difference! ✨`;
    }

    async showChatHelp(msg, params, context) {
        return `💬 *ChatBot Help & Features*\n\n` +
               `🤖 **What I can do:**\n` +
               `• Have natural conversations\n` +
               `• Remember our chat history\n` +
               `• Answer questions on any topic\n` +
               `• Help with tasks and problems\n` +
               `• Provide information and explanations\n` +
               `• Be your AI companion! 🌟\n\n` +
               `⚙️ **Commands:**\n` +
               `• \`.chat on/off\` - Toggle for you/group\n` +
               `• \`.chatstatus\` - Check current status\n` +
               `• \`.clearchat\` - Clear conversation history\n` +
               `• \`.chathelp\` - Show this help\n\n` +
               `💡 **Tips:**\n` +
               `• Just type normally to chat with me\n` +
               `• I remember our conversation context\n` +
               `• Ask me anything - I'm here to help!\n` +
               `• Use commands to control my behavior\n\n` +
               `🚀 Ready to chat? Just send me a message!`;
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
            return null;
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
