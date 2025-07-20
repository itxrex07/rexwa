const logger = require('../../Core/logger');


class MessageUtils {
    static extractText(msg) {
        return msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption || 
               msg.message?.documentMessage?.caption ||
               msg.message?.audioMessage?.caption ||
               '';
    }

    static hasMedia(msg) {
        return !!(
            msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage ||
            msg.message?.documentMessage ||
            msg.message?.stickerMessage ||
            msg.message?.locationMessage ||
            msg.message?.contactMessage
        );
    }

static getMediaType(msg) {
    if (!msg || !msg.message) return null;
    if (msg.message.imageMessage) return 'image';
    if (msg.message.videoMessage) return 'video';
    if (msg.message.audioMessage) return 'audio';
    if (msg.message.documentMessage) return 'document';
    if (msg.message.stickerMessage) return 'sticker';
    if (msg.message.locationMessage) return 'location';
    if (msg.message.contactMessage) return 'contact';
    return null;
}


    static async downloadMedia(msg, bot) {
    try {
        if (!this.hasMedia(msg)) return null;
        const buffer = await bot.sock.downloadMediaMessage(msg);
        if (!buffer || !Buffer.isBuffer(buffer)) return null;
        return buffer;
    } catch (error) {
        logger.error('Failed to download media:', error);
        return null; // don't throw; let calling code decide
    }
}


    static formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    static generateRandomId(length = 8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static isUrl(string) {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }

    static extractUrls(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.match(urlRegex) || [];
    }

    static formatNumber(num) {
        return new Intl.NumberFormat().format(num);
    }

    static toTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    static example(prefix, command, example) {
        return `❌ *Usage Example*\n\n${prefix}${command} ${example}`;
    }

    static texted(style, text) {
        switch (style) {
            case 'bold': return `*${text}*`;
            case 'italic': return `_${text}_`;
            case 'monospace': return `\`\`\`${text}\`\`\``;
            default: return text;
        }
    }

    static jsonFormat(obj) {
        return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
    }

    static filename(ext) {
        return `file_${Date.now()}.${ext}`;
    }

    static async fetchBuffer(url) {
        try {
            const response = await fetch(url);
            return await response.buffer();
        } catch (error) {
            throw new Error(`Failed to fetch buffer: ${error.message}`);
        }
    }

    static async getFile(url) {
        try {
            const response = await fetch(url);
            const buffer = await response.buffer();
            return {
                status: true,
                file: buffer,
                extension: url.split('.').pop() || 'bin',
                mime: response.headers.get('content-type') || 'application/octet-stream'
            };
        } catch (error) {
            return {
                status: false,
                error: error.message
            };
        }
    }

    static sizeLimit(size, maxSize) {
        const sizeInMB = this.parseSize(size);
        const maxSizeInMB = parseInt(maxSize);
        return {
            oversize: sizeInMB > maxSizeInMB,
            size: sizeInMB,
            maxSize: maxSizeInMB
        };
    }

    static parseSize(sizeStr) {
        const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(MB|KB|GB)/i);
        if (!match) return 0;
        
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        
        switch (unit) {
            case 'KB': return value / 1024;
            case 'MB': return value;
            case 'GB': return value * 1024;
            default: return value;
        }
    }
}



module.exports = MessageUtils;
