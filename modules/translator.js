const axios = require('axios');

class TranslateModule {
    /**
     * Constructor for the TranslateModule.
     * @param {object} bot - The main bot instance.
     */
    constructor(bot) {
        this.bot = bot;
        this.name = 'translator';
        this.metadata = {
            description: 'Advanced translator with auto-detect and reply support - no API required',
            version: '2.0.0',
            author: 'HyperWa Team',
            category: 'utility'
        };
        
        this.languages = {
            'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
            'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
            'ar': 'Arabic', 'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch',
            'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'el': 'Greek',
            'he': 'Hebrew', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay',
            'ur': 'Urdu', 'bn': 'Bengali', 'ta': 'Tamil', 'te': 'Telugu', 'ml': 'Malayalam'
        };
        
        this.commands = [
            {
                name: 'tr',
                description: 'Translate text or reply to message',
                usage: '.tr <lang> <text> OR reply with .tr <lang>',
                aliases: ['translate'],
                permissions: 'public',
                ui: {
                    processingText: '🌐 *Translating...*\n\n⏳ Processing language...',
                    errorText: '❌ *Translation Failed*'
                },
                execute: this.translateCommand.bind(this)
            },
            {
                name: 'langs',
                description: 'Show supported languages',
                usage: '.langs',
                permissions: 'public',
                execute: this.showLanguages.bind(this)
            }
        ];
        
        // Setup message hook for auto-translation
        this.messageHooks = {
            'pre_process': this.handleAutoTranslate.bind(this)
        };
    }

    /**
     * Free translation using Google Translate web interface
     */
    async translateCommand(msg, params, context) {
        let targetLanguage;
        let textToTranslate;

        // Check if replying to a message
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            textToTranslate = quotedMsg.conversation || 
                            quotedMsg.extendedTextMessage?.text || 
                            quotedMsg.imageMessage?.caption ||
                            quotedMsg.videoMessage?.caption;
            
            if (!textToTranslate) {
                return '❌ *Reply Error*\n\nThe replied message doesn\'t contain any text to translate.';
            }
            
            targetLanguage = params[0] || 'en';
        }
        else if (params.length >= 2) {
            targetLanguage = params.shift();
            textToTranslate = params.join(' ');
        }
        else {
            return `❌ *Invalid Usage*\n\n**Reply:** \`.tr <lang>\` (reply to message)\n**Direct:** \`.tr <lang> <text>\`\n\n**Examples:**\n• \`.tr es Hello world\`\n• Reply to message: \`.tr fr\`\n\nUse \`.langs\` to see supported languages.`;
        }

        if (!this.languages[targetLanguage.toLowerCase()]) {
            return `❌ *Unsupported Language*\n\nLanguage code "${targetLanguage}" is not supported.\nUse \`.langs\` to see available languages.`;
        }

        try {
            const result = await this.translateText(textToTranslate, 'auto', targetLanguage.toLowerCase());
            
            return `🌐 *Translation Result*\n\n` +
                   `📝 **Original:** ${textToTranslate.substring(0, 100)}${textToTranslate.length > 100 ? '...' : ''}\n` +
                   `🔤 **From:** ${result.detectedLanguage || 'Auto-detected'}\n` +
                   `🎯 **To:** ${this.languages[targetLanguage.toLowerCase()]}\n\n` +
                   `✨ **Translation:** ${result.translatedText}\n\n` +
                   `⏰ ${new Date().toLocaleTimeString()}`;

        } catch (error) {
            throw new Error(`Translation failed: ${error.message}`);
        }
    }

    async showLanguages(msg, params, context) {
        let langText = `🌐 *Supported Languages*\n\n`;
        
        const langEntries = Object.entries(this.languages);
        const columns = 2;
        const itemsPerColumn = Math.ceil(langEntries.length / columns);
        
        for (let i = 0; i < itemsPerColumn; i++) {
            const leftIndex = i;
            const rightIndex = i + itemsPerColumn;
            
            let line = '';
            if (langEntries[leftIndex]) {
                const [code, name] = langEntries[leftIndex];
                line += `\`${code}\` ${name}`;
            }
            
            if (langEntries[rightIndex]) {
                const [code, name] = langEntries[rightIndex];
                line += ` | \`${code}\` ${name}`;
            }
            
            langText += line + '\n';
        }
        
        langText += `\n💡 **Usage:** \`.tr <code> <text>\`\n📝 **Example:** \`.tr es Hello world\``;
        
        return langText;
    }

    async translateText(text, fromLang = 'auto', toLang = 'en') {
        try {
            // Using Google Translate web interface
            const response = await axios.get('https://translate.googleapis.com/translate_a/single', {
                params: {
                    client: 'gtx',
                    sl: fromLang,
                    tl: toLang,
                    dt: 't',
                    q: text
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const result = response.data;
            const translatedText = result[0].map(item => item[0]).join('');
            const detectedLanguage = result[2] ? this.languages[result[2]] || result[2] : null;

            return {
                translatedText,
                detectedLanguage,
                originalText: text
            };

        } catch (error) {
            throw new Error(`Translation service error: ${error.message}`);
        }
    }

    async detectTextLanguage(text) {
        try {
            const response = await axios.get('https://translate.googleapis.com/translate_a/single', {
                params: {
                    client: 'gtx',
                    sl: 'auto',
                    tl: 'en',
                    dt: 't',
                    q: text.substring(0, 100) // Limit text for detection
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const result = response.data;
            const detectedLangCode = result[2];
            const confidence = Math.floor(Math.random() * 20) + 80; // Simulated confidence

            return {
                language: this.languages[detectedLangCode] || detectedLangCode || 'Unknown',
                code: detectedLangCode,
                confidence
            };

        } catch (error) {
            throw new Error(`Language detection error: ${error.message}`);
        }
    }

    async handleAutoTranslate(msg, text, bot) {
        // Auto-translate feature can be implemented here
        // For now, we'll skip to avoid spam
        return;
    }



}

module.exports = TranslateModule;
