
const config = require('../config');

class Helpers {
    static async smartErrorRespond(bot, originalMsg, options = {}) {
        let {
            processingText,
            errorText = '❌ Something went wrong.',
            actionFn = () => { throw new Error('No action provided'); },
            autoReact = config.get('features.autoReact', true),
            editMessages = config.get('features.messageEdit', true),
            smartProcessing = config.get('features.smartProcessing', false),
            selfEdit = config.get('features.selfEditCommands', true)
        } = options;

        if (!bot?.sock?.sendMessage || !originalMsg?.key?.remoteJid) return;

        const sender = originalMsg.key.remoteJid;
        const isFromSelf = originalMsg.key.fromMe === true;
        const originalPassedText = processingText;
        let processingMsgKey = null;

        // ✅ Step 1: fallback only if module didn’t provide anything
        if (!processingText) {
            const cmdText =
                originalMsg?.message?.conversation ||
                originalMsg?.message?.extendedTextMessage?.text ||
                '.';
            const cmdName = cmdText.trim().split(/\s+/)[0];
            processingText = isFromSelf
                ? '⏳ Processing...'
                : `⏳ Running *${cmdName}*...`;
        }

        const isStructured = !!originalPassedText;

        try {
            // ✅ Step 2: React with ⏳
            if (autoReact) {
                await bot.sock.sendMessage(sender, {
                    react: { key: originalMsg.key, text: '⏳' }
                });
            }

            // ✅ Step 3: Show "processing"
            if (isStructured && selfEdit && isFromSelf) {
                await bot.sock.sendMessage(sender, {
                    text: processingText,
                    edit: originalMsg.key
                });
                processingMsgKey = originalMsg.key;
            } else if (editMessages) {
                const processingMsg = await bot.sendMessage(sender, { text: processingText });
                processingMsgKey = processingMsg.key;
            }

            // ✅ Step 4: Run command
            const result = await actionFn();

            // ✅ Step 5: Clear reaction
            if (autoReact) {
                await Helpers.sleep(1000);
                await bot.sock.sendMessage(sender, {
                    react: { key: originalMsg.key, text: '' }
                });
            }

            // ✅ Step 6: Edit result or send fresh
            if (processingMsgKey && typeof result === 'string') {
                await bot.sock.sendMessage(sender, {
                    text: result,
                    edit: processingMsgKey
                });
            } else if (typeof result === 'string') {
                await bot.sendMessage(sender, { text: result });
            }

            return result;

        } catch (error) {
            if (autoReact) {
                await Helpers.sleep(1500);
                await bot.sock.sendMessage(sender, {
                    react: { key: originalMsg.key, text: '❌' }
                });
            }

            const finalErrorText = smartProcessing
                ? `${errorText}\n\n🔍 Error: ${error.message}`
                : errorText;

            if (processingMsgKey) {
                await bot.sock.sendMessage(sender, {
                    text: finalErrorText,
                    edit: processingMsgKey
                });
            } else {
                await bot.sendMessage(sender, { text: finalErrorText });
            }

            throw error;
        }
    }

    static async sendCommandResponse(bot, originalMsg, responseText) {
        await this.smartErrorRespond(bot, originalMsg, {
            processingText: '⏳ Checking command...',
            errorText: responseText,
            actionFn: async () => {
                throw new Error(responseText);
            }
        });
    }

    static formatUptime(startTime) {
        if (typeof startTime !== 'number') return '0s';
        const seconds = Math.floor((Date.now() - startTime) / 1000);
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);
        if (secs || parts.length === 0) parts.push(`${secs}s`);
        return parts.join(' ');
    }

    static formatFileSize(bytes) {
        if (typeof bytes !== 'number' || bytes <= 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    }

    static cleanPhoneNumber(phone) {
        return typeof phone === 'string' ? phone.replace(/[^\d]/g, '') : '';
    }

    static isOwner(participant) {
        const owner = config.get('bot.owner');
        return participant === owner;
    }

    static generateRandomString(length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    }
}

module.exports = Helpers;
