const apiHelper = require('./helpers/api-helper');
const messageUtils = require('./helpers/message-utils');


class DownloadersModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'downloader';
        this.metadata = {
            description: 'Media downloaders from various platforms',
            version: '1.0.0',
            author: 'Neoxr Bot Conversion',
            category: 'downloader'
        };
        this.commands = [
            {
                name: 'ytmp3',
                description: 'Download YouTube audio',
                usage: '.ytmp3 <youtube_url>',
                permissions: 'public',
                ui: {
                    processingText: '🔄 *Processing YouTube Audio...*\n\n⏳ Downloading audio file...',
                    errorText: '❌ *YouTube Audio Download Failed*'
                },
                execute: this.downloadYouTubeAudio.bind(this)
            },
            {
                name: 'ytmp4',
                description: 'Download YouTube video',
                usage: '.ytmp4 <youtube_url>',
                permissions: 'public',
                ui: {
                    processingText: '🔄 *Processing YouTube Video...*\n\n⏳ Downloading video file...',
                    errorText: '❌ *YouTube Video Download Failed*'
                },
                execute: this.downloadYouTubeVideo.bind(this)
            },
            {
                name: 'play',
                description: 'Search and download YouTube audio',
                usage: '.play <search_query>',
                permissions: 'public',
                ui: {
                    processingText: '🔍 *Searching YouTube...*\n\n⏳ Finding and downloading audio...',
                    errorText: '❌ *YouTube Search Failed*'
                },
                execute: this.playAudio.bind(this)
            },
            {
                name: 'video',
                description: 'Search and download YouTube video',
                usage: '.video <search_query>',
                permissions: 'public',
                ui: {
                    processingText: '🔍 *Searching YouTube...*\n\n⏳ Finding and downloading video...',
                    errorText: '❌ *YouTube Video Search Failed*'
                },
                execute: this.playVideo.bind(this)
            },
            {
                name: 'tiktok',
                description: 'Download TikTok video',
                usage: '.tiktok <tiktok_url>',
                permissions: 'public',
                ui: {
                    processingText: '🎵 *Processing TikTok...*\n\n⏳ Downloading video...',
                    errorText: '❌ *TikTok Download Failed*'
                },
                execute: this.downloadTikTok.bind(this)
            },
            {
                name: 'ig',
                description: 'Download Instagram media',
                usage: '.ig <instagram_url>',
                permissions: 'public',
                ui: {
                    processingText: '📸 *Processing Instagram...*\n\n⏳ Downloading media...',
                    errorText: '❌ *Instagram Download Failed*'
                },
                execute: this.downloadInstagram.bind(this)
            },
            {
                name: 'fb',
                description: 'Download Facebook video',
                usage: '.fb <facebook_url>',
                permissions: 'public',
                ui: {
                    processingText: '📘 *Processing Facebook...*\n\n⏳ Downloading video...',
                    errorText: '❌ *Facebook Download Failed*'
                },
                execute: this.downloadFacebook.bind(this)
            },
            {
                name: 'twitter',
                description: 'Download Twitter media',
                usage: '.twitter <twitter_url>',
                permissions: 'public',
                ui: {
                    processingText: '🐦 *Processing Twitter...*\n\n⏳ Downloading media...',
                    errorText: '❌ *Twitter Download Failed*'
                },
                execute: this.downloadTwitter.bind(this)
            },
            {
                name: 'pinterest',
                description: 'Download Pinterest image',
                usage: '.pinterest <pinterest_url_or_query>',
                permissions: 'public',
                ui: {
                    processingText: '📌 *Processing Pinterest...*\n\n⏳ Downloading image...',
                    errorText: '❌ *Pinterest Download Failed*'
                },
                execute: this.downloadPinterest.bind(this)
            },
            {
                name: 'mediafire',
                description: 'Download from MediaFire',
                usage: '.mediafire <mediafire_url>',
                permissions: 'public',
                ui: {
                    processingText: '📁 *Processing MediaFire...*\n\n⏳ Downloading file...',
                    errorText: '❌ *MediaFire Download Failed*'
                },
                execute: this.downloadMediaFire.bind(this)
            },
            {
                name: 'gdrive',
                description: 'Download from Google Drive',
                usage: '.gdrive <gdrive_url>',
                permissions: 'public',
                ui: {
                    processingText: '💾 *Processing Google Drive...*\n\n⏳ Downloading file...',
                    errorText: '❌ *Google Drive Download Failed*'
                },
                execute: this.downloadGoogleDrive.bind(this)
            },
            {
                name: 'spotify',
                description: 'Download Spotify track',
                usage: '.spotify <spotify_url>',
                permissions: 'public',
                ui: {
                    processingText: '🎵 *Processing Spotify...*\n\n⏳ Downloading track...',
                    errorText: '❌ *Spotify Download Failed*'
                },
                execute: this.downloadSpotify.bind(this)
            }
        ];
    }

    async downloadYouTubeAudio(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a YouTube URL\nExample: ytmp3 https://youtu.be/example');
        }

        const url = params[0];
        if (!this.isValidYouTubeUrl(url)) {
            throw new Error('Invalid YouTube URL');
        }

        const result = await apiHelper.neoxrApi('/youtube', {
            url: url,
            type: 'audio',
            quality: '128kbps'
        });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download audio');
        }

        let caption = `🎵 *YouTube Audio*\n\n`;
        caption += `📝 *Title*: ${result.title}\n`;
        caption += `📊 *Size*: ${result.data.size}\n`;
        caption += `⏱️ *Duration*: ${result.duration}\n`;
        caption += `🎧 *Quality*: ${result.data.quality}`;

        await this.bot.sendMessage(context.sender, {
            document: { url: result.data.url },
            fileName: result.data.filename,
            caption: caption,
            mimetype: 'audio/mpeg'
        });

        return caption;
    }

    async downloadYouTubeVideo(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a YouTube URL\nExample: ytmp4 https://youtu.be/example');
        }

        const url = params[0];
        if (!this.isValidYouTubeUrl(url)) {
            throw new Error('Invalid YouTube URL');
        }

        let result = await apiHelper.neoxrApi('/youtube', {
            url: url,
            type: 'video',
            quality: '720p'
        });

        // Fallback to 480p if 720p fails
        if (!result.status) {
            result = await apiHelper.neoxrApi('/youtube', {
                url: url,
                type: 'video',
                quality: '480p'
            });
        }

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download video');
        }

        let caption = `🎬 *YouTube Video*\n\n`;
        caption += `📝 *Title*: ${result.title}\n`;
        caption += `📊 *Size*: ${result.data.size}\n`;
        caption += `⏱️ *Duration*: ${result.duration}\n`;
        caption += `📺 *Quality*: ${result.data.quality}`;

        await this.bot.sendMessage(context.sender, {
            video: { url: result.data.url },
            caption: caption
        });

        return caption;
    }

    async playAudio(msg, params, context) {
        if (!params.length) {
            throw new Error('Please provide a search query\nExample: play lathi');
        }

        const query = params.join(' ');
        const result = await apiHelper.neoxrApi('/play', { q: query });

        if (!result.status) {
            throw new Error(result.msg || 'No results found');
        }

        let caption = `🎵 *YouTube Play*\n\n`;
        caption += `📝 *Title*: ${result.title}\n`;
        caption += `📊 *Size*: ${result.data.size}\n`;
        caption += `⏱️ *Duration*: ${result.duration}\n`;
        caption += `🎧 *Quality*: ${result.data.quality}`;

        await this.bot.sendMessage(context.sender, {
            document: { url: result.data.url },
            fileName: result.data.filename,
            caption: caption,
            mimetype: 'audio/mpeg'
        });

        return caption;
    }

    async playVideo(msg, params, context) {
        if (!params.length) {
            throw new Error('Please provide a search query\nExample: video lathi');
        }

        const query = params.join(' ');
        const result = await apiHelper.neoxrApi('/video', { q: query });

        if (!result.status) {
            throw new Error(result.msg || 'No results found');
        }

        let caption = `🎬 *YouTube Video*\n\n`;
        caption += `📝 *Title*: ${result.title}\n`;
        caption += `📊 *Size*: ${result.data.size}\n`;
        caption += `⏱️ *Duration*: ${result.duration}\n`;
        caption += `📺 *Quality*: ${result.data.quality}`;

        await this.bot.sendMessage(context.sender, {
            video: { url: result.data.url },
            caption: caption
        });

        return caption;
    }

    async downloadTikTok(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a TikTok URL\nExample: tiktok https://vm.tiktok.com/example');
        }

        const url = params[0];
        if (!url.includes('tiktok.com')) {
            throw new Error('Invalid TikTok URL');
        }

        const result = await apiHelper.neoxrApi('/tiktok', { url: this.fixTikTokUrl(url) });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download TikTok video');
        }

        if (result.data.video) {
            await this.bot.sendMessage(context.sender, {
                video: { url: result.data.video },
                caption: '🎵 *TikTok Video*'
            });
            return '🎵 *TikTok Video Downloaded*';
        } else if (result.data.photo && result.data.photo.length > 0) {
            for (const photoUrl of result.data.photo) {
                await this.bot.sendMessage(context.sender, {
                    image: { url: photoUrl },
                    caption: '📸 *TikTok Photo*'
                });
                await messageUtils.delay(1000);
            }
            return `📸 *${result.data.photo.length} TikTok Photos Downloaded*`;
        }

        throw new Error('No media found in TikTok post');
    }

    async downloadInstagram(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide an Instagram URL\nExample: ig https://www.instagram.com/p/example');
        }

        const url = params[0];
        if (!url.includes('instagram.com')) {
            throw new Error('Invalid Instagram URL');
        }

        const result = await apiHelper.neoxrApi('/ig', { url: this.fixInstagramUrl(url) });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download Instagram media');
        }

        for (const media of result.data) {
            if (media.type === 'mp4') {
                await this.bot.sendMessage(context.sender, {
                    video: { url: media.url },
                    caption: '📱 *Instagram Video*'
                });
            } else {
                await this.bot.sendMessage(context.sender, {
                    image: { url: media.url },
                    caption: '📸 *Instagram Photo*'
                });
            }
            await messageUtils.delay(1000);
        }

        return `📱 *${result.data.length} Instagram Media Downloaded*`;
    }

    async downloadFacebook(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a Facebook URL\nExample: fb https://fb.watch/example');
        }

        const url = params[0];
        if (!url.match(/(?:https?:\/\/(web\.|www\.|m\.)?(facebook|fb)\.(com|watch)\S+)?$/)) {
            throw new Error('Invalid Facebook URL');
        }

        const result = await apiHelper.neoxrApi('/fb', { url: url });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download Facebook video');
        }

        // Try HD quality first, then SD
        let videoData = result.data.find(v => v.quality === 'HD' && v.response === 200);
        if (!videoData) {
            videoData = result.data.find(v => v.quality === 'SD' && v.response === 200);
        }

        if (!videoData) {
            throw new Error('No valid video quality found');
        }

        await this.bot.sendMessage(context.sender, {
            video: { url: videoData.url },
            caption: `📘 *Facebook Video*\n🎬 *Quality*: ${videoData.quality}`
        });

        return `📘 *Facebook Video Downloaded (${videoData.quality})*`;
    }

    async downloadTwitter(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a Twitter URL\nExample: twitter https://twitter.com/user/status/example');
        }

        const url = params[0];
        if (!url.includes('twitter.com') && !url.includes('x.com')) {
            throw new Error('Invalid Twitter URL');
        }

        const result = await apiHelper.neoxrApi('/twitter', { url: url });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download Twitter media');
        }

        for (const media of result.data) {
            if (media.type === 'mp4') {
                await this.bot.sendMessage(context.sender, {
                    video: { url: media.url },
                    caption: '🐦 *Twitter Video*'
                });
            } else if (media.type === 'gif') {
                await this.bot.sendMessage(context.sender, {
                    video: { url: media.url },
                    caption: '🐦 *Twitter GIF*',
                    gifPlayback: true
                });
            } else {
                await this.bot.sendMessage(context.sender, {
                    image: { url: media.url },
                    caption: '🐦 *Twitter Image*'
                });
            }
            await messageUtils.delay(1000);
        }

        return `🐦 *${result.data.length} Twitter Media Downloaded*`;
    }

    async downloadPinterest(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a Pinterest URL or search query\nExample: pinterest https://pin.it/example');
        }

        const input = params.join(' ');

        let result;
        if (messageUtils.isUrl(input) && input.match(/pin(?:terest)?(?:\.it|\.com)/)) {
            // Download specific pin
            result = await apiHelper.neoxrApi('/pin', { url: input });
        } else {
            // Search Pinterest
            result = await apiHelper.neoxrApi('/pinterest', { q: input });
            if (result.status && result.data.length > 0) {
                // Send random image from search results
                const randomIndex = Math.floor(Math.random() * Math.min(5, result.data.length));
                const imageUrl = result.data[randomIndex];
                await this.bot.sendMessage(context.sender, {
                    image: { url: imageUrl },
                    caption: '📌 *Pinterest Image*'
                });
                return '📌 *Pinterest Image Downloaded*';
            }
        }

        if (!result.status) {
            throw new Error(result.msg || 'Failed to process Pinterest request');
        }

        if (result.data.type === 'gif') {
            await this.bot.sendMessage(context.sender, {
                video: { url: result.data.url },
                caption: '📌 *Pinterest GIF*',
                gifPlayback: true
            });
        } else {
            await this.bot.sendMessage(context.sender, {
                image: { url: result.data.url },
                caption: '📌 *Pinterest Image*'
            });
        }

        return '📌 *Pinterest Media Downloaded*';
    }

    async downloadMediaFire(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a MediaFire URL\nExample: mediafire https://www.mediafire.com/file/example');
        }

        const url = params[0];
        if (!url.includes('mediafire.com')) {
            throw new Error('Invalid MediaFire URL');
        }

        const result = await apiHelper.neoxrApi('/mediafire', { url: url });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download from MediaFire');
        }

        let caption = `📁 *MediaFire Download*\n\n`;
        caption += `📝 *Name*: ${result.data.title}\n`;
        caption += `📊 *Size*: ${result.data.size}\n`;
        caption += `📄 *Type*: ${result.data.extension}\n`;
        caption += `🔗 *Mime*: ${result.data.mime}`;

        await this.bot.sendMessage(context.sender, {
            document: { url: result.data.url },
            fileName: result.data.title,
            caption: caption
        });

        return caption;
    }

    async downloadGoogleDrive(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a Google Drive URL\nExample: gdrive https://drive.google.com/file/d/example');
        }

        const url = params[0];
        if (!url.includes('drive.google.com')) {
            throw new Error('Invalid Google Drive URL');
        }

        const result = await apiHelper.neoxrApi('/gdrive', { url: url });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download from Google Drive');
        }

        await this.bot.sendMessage(context.sender, {
            document: { url: result.data.url },
            fileName: result.data.filename || 'gdrive_file',
            caption: '💾 *Google Drive Download*'
        });

        return '💾 *Google Drive File Downloaded*';
    }

    async downloadSpotify(msg, params, context) {
        if (!params[0]) {
            throw new Error('Please provide a Spotify URL\nExample: spotify https://open.spotify.com/track/example');
        }

        const url = params[0];
        if (!url.includes('spotify.com')) {
            throw new Error('Invalid Spotify URL');
        }

        const result = await apiHelper.neoxrApi('/spotify', { url: url });

        if (!result.status) {
            throw new Error(result.msg || 'Failed to download Spotify track');
        }

        let caption = `🎵 *Spotify Track*\n\n`;
        caption += `📝 *Title*: ${result.data.title}\n`;
        caption += `👤 *Artist*: ${result.data.artist.name}\n`;
        caption += `💿 *Album*: ${result.data.album}\n`;
        caption += `⏱️ *Duration*: ${result.data.duration}`;

        await this.bot.sendMessage(context.sender, {
            audio: { url: result.data.url },
            caption: caption,
            mimetype: 'audio/mpeg'
        });

        return caption;
    }

    // Helper methods
    isValidYouTubeUrl(url) {
        return /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtu\.?be(?:\.com)?\/?.*(?:watch|embed)?(?:.*v=|v\/|\/)([\w\-_]+)\&?/.test(url);
    }

    fixTikTokUrl(url) {
        return url.replace(/\?.*/, '');
    }

    fixInstagramUrl(url) {
        return url.replace(/\?.*/, '');
    }
}

module.exports = DownloadersModule;
