const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const logger = require('../Core/logger');

class AssistantModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'assistant';
        this.metadata = {
            description: 'AI-powered bot assistant with Gemini integration - monitors, fixes, and assists',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'ai'
        };

        // Gemini API configuration
        this.apiKey = "AIzaSyC1-5hrYIdfNsg2B7bcb5Qs3ib1MIWlbOE";
        this.genAI = null;
        this.model = null;
        this.visionModel = null;

        // Assistant state
        this.isActive = false;
        this.conversations = new Map();
        this.errorHistory = [];
        this.codeAnalysisCache = new Map();
        this.lastHealthCheck = Date.now();

        this.commands = [
            {
                name: 'assistant',
                description: 'Toggle AI assistant on/off',
                usage: '.assistant on/off',
                permissions: 'owner',
                aliases: ['hyper', 'jarvis'],
                execute: this.toggleAssistant.bind(this)
            },
            {
                name: 'chatassistant',
                description: 'Toggle chat assistant mode',
                usage: '.chatassistant on/off',
                permissions: 'owner',
                aliases: ['hyperai'],
                execute: this.toggleChatAssistant.bind(this)
            },
            {
                name: 'botassistant',
                description: 'Toggle bot monitoring assistant',
                usage: '.botassistant on/off',
                permissions: 'owner',
                aliases: ['hyperasis'],
                execute: this.toggleBotAssistant.bind(this)
            },
            {
                name: 'fixcode',
                description: 'Analyze and fix bot code issues',
                usage: '.fixcode [module_name]',
                permissions: 'owner',
                execute: this.analyzeAndFixCode.bind(this)
            },
            {
                name: 'healthcheck',
                description: 'Run comprehensive bot health check',
                usage: '.healthcheck',
                permissions: 'owner',
                execute: this.runHealthCheck.bind(this)
            },
            {
                name: 'generate',
                description: 'Generate content using AI',
                usage: '.generate <prompt>',
                permissions: 'public',
                execute: this.generateContent.bind(this)
            }
        ];

        // Message hooks for monitoring and assistance
        this.messageHooks = {
            'pre_process': this.handlePreProcess.bind(this),
            'post_process': this.handlePostProcess.bind(this)
        };

        // Settings
        this.settings = {
            chatAssistant: false,
            botAssistant: false,
            autoFix: true,
            smartSuggestions: true,
            errorMonitoring: true,
            healthCheckInterval: 300000 // 5 minutes
        };
    }

    async init() {
        if (!this.apiKey || this.apiKey === "YOUR_GEMINI_API_KEY") {
            logger.error('❌ Gemini API key is missing for Assistant module');
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

        this.visionModel = this.genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });

        // Start health monitoring
        this.startHealthMonitoring();
        
        logger.info('✅ Assistant module initialized with Gemini 2.0 Flash');
    }

    async toggleAssistant(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `🤖 *AI Assistant Status*\n\n` +
                   `Chat Assistant: ${this.settings.chatAssistant ? '✅' : '❌'}\n` +
                   `Bot Assistant: ${this.settings.botAssistant ? '✅' : '❌'}\n` +
                   `Auto Fix: ${this.settings.autoFix ? '✅' : '❌'}\n` +
                   `Smart Suggestions: ${this.settings.smartSuggestions ? '✅' : '❌'}\n\n` +
                   `Usage: .assistant on/off`;
        }

        this.isActive = action === 'on';
        this.settings.chatAssistant = this.isActive;
        this.settings.botAssistant = this.isActive;

        return `🤖 *AI Assistant ${action === 'on' ? 'Activated' : 'Deactivated'}*\n\n` +
               `${action === 'on' ? '🟢' : '🔴'} All assistant features are now ${action === 'on' ? 'enabled' : 'disabled'}`;
    }

    async toggleChatAssistant(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `💬 *Chat Assistant: ${this.settings.chatAssistant ? '✅ ON' : '❌ OFF'}*\n\nUsage: .chatassistant on/off`;
        }

        this.settings.chatAssistant = action === 'on';
        
        return `💬 *Chat Assistant ${action === 'on' ? 'Enabled' : 'Disabled'}*\n\n` +
               `${action === 'on' ? 'I\'ll now assist with conversations and provide intelligent responses!' : 'Chat assistance disabled.'}`;
    }

    async toggleBotAssistant(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `🔧 *Bot Assistant: ${this.settings.botAssistant ? '✅ ON' : '❌ OFF'}*\n\nUsage: .botassistant on/off`;
        }

        this.settings.botAssistant = action === 'on';
        
        return `🔧 *Bot Assistant ${action === 'on' ? 'Enabled' : 'Disabled'}*\n\n` +
               `${action === 'on' ? 'I\'ll now monitor bot health and auto-fix issues!' : 'Bot monitoring disabled.'}`;
    }

    async handlePreProcess(msg, text, bot) {
        if (!this.settings.chatAssistant && !this.settings.smartSuggestions) return;

        const sender = msg.key.remoteJid;
        const participant = msg.key.participant || sender;

        // Handle wrong commands with smart suggestions
        if (text && text.startsWith(config.get('bot.prefix'))) {
            const command = text.slice(config.get('bot.prefix').length).split(' ')[0].toLowerCase();
            const handler = bot.messageHandler.commandHandlers.get(command);
            
            if (!handler && this.settings.smartSuggestions) {
                const suggestion = await this.suggestCommand(command, text);
                if (suggestion) {
                    await bot.sendMessage(sender, {
                        text: `🤖 *Command not found!*\n\n💡 Did you mean: \`${suggestion}\`?\n\n🔍 Or try: \`.help\` for available commands`
                    });
                }
            }
        }

        // Handle links automatically
        if (text && this.containsLink(text) && this.settings.chatAssistant) {
            await this.handleLinkProcessing(msg, text, bot);
        }
    }

    async handlePostProcess(msg, text, bot) {
        if (!this.settings.errorMonitoring) return;

        // Monitor for errors and issues
        try {
            const errorPattern = /error|failed|exception|crash/i;
            if (text && errorPattern.test(text)) {
                this.errorHistory.push({
                    timestamp: Date.now(),
                    message: text,
                    sender: msg.key.remoteJid
                });

                if (this.settings.autoFix) {
                    await this.analyzeError(text, msg.key.remoteJid);
                }
            }
        } catch (error) {
            logger.error('Error in post-process monitoring:', error);
        }
    }

    async suggestCommand(wrongCommand, fullText) {
        try {
            const availableCommands = [...this.bot.messageHandler.commandHandlers.keys()];
            
            const prompt = `Given the wrong command "${wrongCommand}" and full text "${fullText}", suggest the most appropriate command from this list: ${availableCommands.join(', ')}. 

Consider:
1. Similar spelling/typing errors
2. Intent behind the command
3. Context of the message

Respond with ONLY the suggested command name, nothing else.`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const suggestion = response.text().trim();

            return availableCommands.includes(suggestion) ? suggestion : null;
        } catch (error) {
            logger.error('Error suggesting command:', error);
            return null;
        }
    }

    async handleLinkProcessing(msg, text, bot) {
        try {
            const links = this.extractLinks(text);
            if (links.length === 0) return;

            const sender = msg.key.remoteJid;
            
            for (const link of links) {
                if (this.isVideoLink(link)) {
                    await bot.sendMessage(sender, {
                        text: `🔗 *Link Detected!*\n\n📹 I can download this video for you!\n\nUse: \`.tiktok ${link}\` or \`.yt ${link}\` depending on the platform.`
                    });
                } else if (this.isImageLink(link)) {
                    await bot.sendMessage(sender, {
                        text: `🖼️ *Image Link Detected!*\n\nI can analyze this image if you send it to me!`
                    });
                }
            }
        } catch (error) {
            logger.error('Error processing links:', error);
        }
    }

    async analyzeAndFixCode(msg, params, context) {
        const moduleName = params[0];
        
        try {
            let analysisResult;
            
            if (moduleName) {
                analysisResult = await this.analyzeSpecificModule(moduleName);
            } else {
                analysisResult = await this.analyzeAllModules();
            }

            const fixedFiles = await this.generateFixedCode(analysisResult);
            
            let response = `🔧 *Code Analysis Complete*\n\n`;
            response += `📊 Issues Found: ${analysisResult.issues.length}\n`;
            response += `✅ Fixes Applied: ${fixedFiles.length}\n\n`;
            
            if (analysisResult.issues.length > 0) {
                response += `🐛 *Issues Detected:*\n`;
                analysisResult.issues.forEach((issue, index) => {
                    response += `${index + 1}. ${issue.type}: ${issue.description}\n`;
                });
            }

            if (fixedFiles.length > 0) {
                response += `\n📁 *Fixed Files:*\n`;
                fixedFiles.forEach(file => {
                    response += `• ${file}\n`;
                });
            }

            await context.bot.sendMessage(context.sender, { text: response });

        } catch (error) {
            throw new Error(`Code analysis failed: ${error.message}`);
        }
    }

    async runHealthCheck(msg, params, context) {
        try {
            const health = await this.performHealthCheck();
            
            let response = `🏥 *Bot Health Check*\n\n`;
            response += `🟢 Overall Status: ${health.overall}\n`;
            response += `💾 Memory Usage: ${health.memory}%\n`;
            response += `⚡ CPU Usage: ${health.cpu}%\n`;
            response += `📊 Active Modules: ${health.modules}\n`;
            response += `🔗 WhatsApp Connection: ${health.whatsapp ? '✅' : '❌'}\n`;
            response += `📱 Telegram Bridge: ${health.telegram ? '✅' : '❌'}\n\n`;
            
            if (health.issues.length > 0) {
                response += `⚠️ *Issues Found:*\n`;
                health.issues.forEach(issue => {
                    response += `• ${issue}\n`;
                });
            } else {
                response += `✅ *No issues detected!*`;
            }

            return response;

        } catch (error) {
            throw new Error(`Health check failed: ${error.message}`);
        }
    }

    async generateContent(msg, params, context) {
        if (params.length === 0) {
            return '🤖 *AI Content Generator*\n\nPlease provide a prompt.\n\n💡 Usage: `.generate <prompt>`\n📝 Example: `.generate Create a funny meme caption`';
        }

        const prompt = params.join(' ');

        try {
            // Check if it's an image generation request
            if (this.isImageGenerationRequest(prompt)) {
                return await this.handleImageGeneration(prompt, context);
            }

            // Regular text generation
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const content = response.text();

            return `🤖 *AI Generated Content*\n\n${content}`;

        } catch (error) {
            throw new Error(`Content generation failed: ${error.message}`);
        }
    }

    async analyzeSpecificModule(moduleName) {
        const modulePath = path.join(__dirname, `${moduleName}.js`);
        
        if (!await fs.pathExists(modulePath)) {
            throw new Error(`Module ${moduleName} not found`);
        }

        const code = await fs.readFile(modulePath, 'utf8');
        return await this.analyzeCode(code, moduleName);
    }

    async analyzeAllModules() {
        const modulesDir = path.join(__dirname);
        const files = await fs.readdir(modulesDir);
        const jsFiles = files.filter(file => file.endsWith('.js'));
        
        const allIssues = [];
        
        for (const file of jsFiles) {
            try {
                const code = await fs.readFile(path.join(modulesDir, file), 'utf8');
                const analysis = await this.analyzeCode(code, file);
                allIssues.push(...analysis.issues);
            } catch (error) {
                allIssues.push({
                    type: 'Analysis Error',
                    description: `Failed to analyze ${file}: ${error.message}`,
                    file: file
                });
            }
        }

        return { issues: allIssues };
    }

    async analyzeCode(code, fileName) {
        try {
            const prompt = `Analyze this JavaScript/Node.js code for potential issues, bugs, and improvements:

File: ${fileName}
Code:
\`\`\`javascript
${code}
\`\`\`

Look for:
1. Syntax errors
2. Logic errors
3. Memory leaks
4. Security vulnerabilities
5. Performance issues
6. Best practice violations

Return a JSON array of issues with format:
[{"type": "Error Type", "description": "Description", "line": number, "severity": "high/medium/low"}]`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const analysisText = response.text();

            try {
                const issues = JSON.parse(analysisText);
                return { issues: Array.isArray(issues) ? issues : [] };
            } catch (parseError) {
                return { issues: [{ type: 'Analysis', description: analysisText, severity: 'medium' }] };
            }

        } catch (error) {
            return { issues: [{ type: 'Analysis Error', description: error.message, severity: 'high' }] };
        }
    }

    async generateFixedCode(analysisResult) {
        const fixedFiles = [];
        
        if (analysisResult.issues.length === 0) return fixedFiles;

        try {
            // Group issues by file
            const issuesByFile = {};
            analysisResult.issues.forEach(issue => {
                const file = issue.file || 'unknown';
                if (!issuesByFile[file]) issuesByFile[file] = [];
                issuesByFile[file].push(issue);
            });

            // Generate fixes for each file
            for (const [fileName, issues] of Object.entries(issuesByFile)) {
                if (fileName === 'unknown') continue;
                
                const fixedCode = await this.generateCodeFix(fileName, issues);
                if (fixedCode) {
                    const fixedFilePath = path.join(__dirname, `../fixed_${fileName}`);
                    await fs.writeFile(fixedFilePath, fixedCode);
                    fixedFiles.push(`fixed_${fileName}`);
                }
            }

        } catch (error) {
            logger.error('Error generating fixed code:', error);
        }

        return fixedFiles;
    }

    async generateCodeFix(fileName, issues) {
        try {
            const originalCode = await fs.readFile(path.join(__dirname, fileName), 'utf8');
            
            const prompt = `Fix the following issues in this JavaScript code:

Original Code:
\`\`\`javascript
${originalCode}
\`\`\`

Issues to fix:
${issues.map(issue => `- ${issue.type}: ${issue.description}`).join('\n')}

Return the complete fixed code with all issues resolved. Maintain the original structure and functionality.`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text().replace(/```javascript\n?|```\n?/g, '');

        } catch (error) {
            logger.error(`Error fixing code for ${fileName}:`, error);
            return null;
        }
    }

    async performHealthCheck() {
        const memUsage = process.memoryUsage();
        const totalMem = require('os').totalmem();
        const freeMem = require('os').freemem();
        
        const health = {
            overall: 'Healthy',
            memory: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
            cpu: Math.round(((totalMem - freeMem) / totalMem) * 100),
            modules: this.bot.moduleLoader.modules.size,
            whatsapp: !!this.bot.sock?.user,
            telegram: !!this.bot.telegramBridge?.telegramBot,
            issues: []
        };

        // Check for issues
        if (health.memory > 80) {
            health.issues.push('High memory usage detected');
            health.overall = 'Warning';
        }

        if (health.cpu > 90) {
            health.issues.push('High CPU usage detected');
            health.overall = 'Critical';
        }

        if (!health.whatsapp) {
            health.issues.push('WhatsApp connection lost');
            health.overall = 'Critical';
        }

        return health;
    }

    startHealthMonitoring() {
        setInterval(async () => {
            if (!this.settings.botAssistant) return;

            try {
                const health = await this.performHealthCheck();
                
                if (health.overall === 'Critical' && this.settings.autoFix) {
                    const owner = config.get('bot.owner');
                    if (owner) {
                        await this.bot.sendMessage(owner, {
                            text: `🚨 *Critical Bot Health Alert*\n\n${health.issues.join('\n')}\n\n🔧 Attempting auto-recovery...`
                        });
                        
                        await this.attemptAutoRecovery(health);
                    }
                }

                this.lastHealthCheck = Date.now();
            } catch (error) {
                logger.error('Health monitoring error:', error);
            }
        }, this.settings.healthCheckInterval);
    }

    async attemptAutoRecovery(health) {
        try {
            // Attempt memory cleanup
            if (health.memory > 80) {
                global.gc && global.gc();
                this.conversations.clear();
                this.codeAnalysisCache.clear();
            }

            // Attempt WhatsApp reconnection
            if (!health.whatsapp) {
                await this.bot.startWhatsApp();
            }

        } catch (error) {
            logger.error('Auto-recovery failed:', error);
        }
    }

    containsLink(text) {
        const linkRegex = /(https?:\/\/[^\s]+)/gi;
        return linkRegex.test(text);
    }

    extractLinks(text) {
        const linkRegex = /(https?:\/\/[^\s]+)/gi;
        return text.match(linkRegex) || [];
    }

    isVideoLink(link) {
        return /tiktok|youtube|instagram|twitter|facebook/i.test(link);
    }

    isImageLink(link) {
        return /\.(jpg|jpeg|png|gif|webp)$/i.test(link);
    }

    isImageGenerationRequest(prompt) {
        const imageKeywords = ['generate image', 'create picture', 'make image', 'draw', 'picture of', 'image of'];
        return imageKeywords.some(keyword => prompt.toLowerCase().includes(keyword));
    }

    async handleImageGeneration(prompt, context) {
        // Since Gemini can't generate images directly, provide guidance
        return `🎨 *Image Generation Request*\n\n` +
               `I understand you want to generate an image, but I can't create images directly.\n\n` +
               `💡 *Alternatives:*\n` +
               `• Use DALL-E or Midjourney for image generation\n` +
               `• I can help you create detailed prompts for image generators\n` +
               `• I can analyze images you send me\n\n` +
               `🤖 Would you like me to help create a detailed prompt for an image generator?`;
    }

    async analyzeError(errorText, sender) {
        try {
            const prompt = `Analyze this error and provide a solution:

Error: ${errorText}

Provide:
1. What caused the error
2. How to fix it
3. Prevention tips

Keep it concise and actionable.`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const analysis = response.text();

            if (sender === config.get('bot.owner')) {
                await this.bot.sendMessage(sender, {
                    text: `🔧 *Error Analysis*\n\n${analysis}`
                });
            }

        } catch (error) {
            logger.error('Error analyzing error:', error);
        }
    }
}

module.exports = AssistantModule;
