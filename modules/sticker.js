const fs = require('fs-extra');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

class StickerModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'sticker';
        this.metadata = {
            description: 'Create and manage stickers from images, videos, and text',
            version: '1.2.0',
            author: 'HyperWa Team',
            category: 'media',
        };
        this.commands = [
            {
                name: 'sticker',
                description: 'Create sticker from image/video',
                usage: '.sticker (reply to image/video)',
                aliases: ['s'], 
                permissions: 'public',
                ui: { processingText: null, errorText: '❌ *Sticker Creation Failed*' },
                execute: this.createSticker.bind(this)
            },
            {
                name: 'textsticker',
                description: 'Create sticker from text',
                usage: '.textsticker <text>',
                permissions: 'public',
                ui: { processingText: null, errorText: '❌ *Text Sticker Creation Failed*' },
                execute: this.createTextSticker.bind(this)
            },
            {
                name: 'anim',
                description: 'Create animated sticker from video/GIF',
                usage: '.anim (reply to video/GIF)',
                permissions: 'public',
                ui: { processingText: null, errorText: '❌ *Animated Sticker Creation Failed*' },
                execute: this.createAnimatedSticker.bind(this)
            },
            {
                name: 'steal',
                description: 'Steal sticker and recreate with custom metadata',
                usage: '.steal <pack_name> | <author> (reply to sticker)',
                permissions: 'public',
                ui: { processingText: null, errorText: '❌ *Sticker Stealing Failed*' },
                execute: this.stealSticker.bind(this)
            },
            {
                name: 'toimg',
                description: 'Converts sticker to image or GIF',
                usage: '.toimg (reply to a sticker)',
                aliases: ['togif'], 
                permissions: 'public',
                ui: {
                    processingText: null,
                    errorText: '❌ *Conversion Failed*'
                },
                execute: this.convertStickerToMedia.bind(this)
            }
        ];
        this.tempDir = path.join(__dirname, '../temp');
    }


    async convertStickerToMedia(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMsg?.stickerMessage) {
            return '❌ *Invalid Reply*\n\nPlease reply to a sticker to convert it.';
        }

        try {
            const stickerMessage = quotedMsg.stickerMessage;
            const stream = await downloadContentFromMessage(stickerMessage, 'sticker');
            const stickerBuffer = Buffer.concat((await stream.toArray()));
            const sharp = require('sharp');

            if (stickerMessage.isAnimated) {
                // Convert animated WEBP sticker to a GIF
                const gifBuffer = await sharp(stickerBuffer, { animated: true }).gif().toBuffer();
                await context.bot.sendMessage(context.sender, {
                    video: gifBuffer,
                    gifPlayback: true
                });
            } else {
                // Convert static WEBP sticker to a PNG image
                const pngBuffer = await sharp(stickerBuffer).png().toBuffer();
                await context.bot.sendMessage(context.sender, {
                    image: pngBuffer
                });
            }

            return null;

        } catch (error) {
            console.error("Sticker conversion error:", error);
            if (error.message.includes('Cannot find module \'sharp\'')) {
                throw new Error('Conversion failed: The `sharp` library is not installed. Please run `npm install sharp`.');
            }
            throw new Error(`Conversion failed: ${error.message}`);
        }
    }


    async createSticker(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg) return '❌ *Sticker Creation*\n\nPlease reply to an image or video to create a sticker.';
        try {
            let mediaBuffer, mediaType;
            if (quotedMsg.imageMessage) {
                const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                mediaBuffer = Buffer.concat((await stream.toArray()));
                mediaType = 'image';
            } else if (quotedMsg.videoMessage) {
                const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
                mediaBuffer = Buffer.concat((await stream.toArray()));
                mediaType = 'video';
            } else {
                return '❌ *Unsupported Media*\n\nPlease reply to an image or video file.';
            }
            const sticker = new Sticker(mediaBuffer, { pack: 'HyperWa Stickers', author: 'HyperWa Bot', type: mediaType === 'video' ? StickerTypes.FULL : StickerTypes.DEFAULT, quality: 50 });
            await context.bot.sendMessage(context.sender, { sticker: await sticker.toBuffer() });
            return null;
        } catch (error) { throw new Error(`Sticker creation failed: ${error.message}`); }
    }

    async createTextSticker(msg, params, context) {
        if (params.length === 0) return '❌ *Text Sticker*\n\nPlease provide text to create a sticker.\n\n💡 Usage: `.textsticker Hello World!`';
        const text = params.join(' ');
        if (text.length > 100) return '❌ *Text Too Long*\n\nMaximum text length is 100 characters.';
        try {
            const textImageBuffer = await this.createTextImage(text);
            const sticker = new Sticker(textImageBuffer, { pack: 'HyperWa Text Stickers', author: 'HyperWa Bot', type: StickerTypes.DEFAULT, quality: 50 });
            await context.bot.sendMessage(context.sender, { sticker: await sticker.toBuffer() });
            return null;
        } catch (error) { throw new Error(`Text sticker creation failed: ${error.message}`); }
    }

    async createAnimatedSticker(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg?.videoMessage) return '❌ *Animated Sticker*\n\nPlease reply to a video or GIF.';
        try {
            const videoMessage = quotedMsg.videoMessage;
            if (videoMessage.seconds && videoMessage.seconds > 6) return '❌ *Video Too Long*\n\nAnimated stickers must be 6 seconds or less.';
            const stream = await downloadContentFromMessage(videoMessage, 'video');
            const mediaBuffer = Buffer.concat((await stream.toArray()));
            const sticker = new Sticker(mediaBuffer, { pack: 'HyperWa Animated', author: 'HyperWa Bot', type: StickerTypes.FULL, quality: 30 });
            await context.bot.sendMessage(context.sender, { sticker: await sticker.toBuffer() });
            return null;
        } catch (error) { throw new Error(`Animated sticker creation failed: ${error.message}`); }
    }

    async stealSticker(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMsg?.stickerMessage) return '❌ *Sticker Stealing*\n\nPlease reply to a sticker to steal it.';
        let packName = 'HyperWa Stolen', authorName = 'HyperWa Bot';
        if (params.length > 0) {
            const [pack, author] = params.join(' ').split('|').map(p => p.trim());
            if (pack) packName = pack;
            if (author) authorName = author;
        }
        try {
            const stream = await downloadContentFromMessage(quotedMsg.stickerMessage, 'sticker');
            const stickerBuffer = Buffer.concat((await stream.toArray()));
            const sticker = new Sticker(stickerBuffer, { pack: packName, author: authorName, type: quotedMsg.stickerMessage.isAnimated ? StickerTypes.FULL : StickerTypes.DEFAULT, quality: 50 });
            await context.bot.sendMessage(context.sender, { sticker: await sticker.toBuffer() });
            return null;
        } catch (error) { throw new Error(`Sticker stealing failed: ${error.message}`); }
    }

    async createTextImage(text) {
        try {
            const sharp = require('sharp');
            const svg = `<svg width="512" height="512"><style>.title { fill: #000; font-size: 40px; font-family: Arial, sans-serif; text-anchor: middle; }</style><text x="50%" y="50%" class="title" dominant-baseline="middle">${text}</text></svg>`;
            return await sharp(Buffer.from(svg)).webp().toBuffer();
        } catch (error) {
            console.warn('Sharp library not found or failed. Text sticker creation depends on it.');
            throw new Error('Text-to-image conversion failed. Is `sharp` installed?');
        }
    }


}

module.exports = StickerModule;
