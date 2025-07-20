const config = require('../config');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const helpers = require('../utils/helpers');


class CoreModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'core';
        this.metadata = {
            description: 'Core commands for bot control and monitoring',
            version: '2.1.0',
            author: 'HyperWA',
            category: 'system'
        };
        this.commands = [
            {
                name: 'ping',
                description: 'Check bot response time',
                usage: '.ping',
                permissions: 'public',
                ui: {
                    processingText: '🏓 *Pinging...*',
                    errorText: '❌ Failed to ping'
                },
                execute: this.ping.bind(this)
            },
            {
                name: 'status',
                description: 'Show bot status and statistics',
                usage: '.status',
                permissions: 'public',
                ui: {
                    processingText: '📊 Gathering status...',
                    errorText: '❌ Failed to retrieve status'
                },
                execute: this.status.bind(this)
            },
            {
                name: 'restart',
                description: 'Restart the bot (owner only)',
                usage: '.restart',
                permissions: 'owner',
                ui: {
                    processingText: '🔄 Restarting bot...',
                    errorText: '❌ Restart failed'
                },
                execute: this.restart.bind(this)
            },
            {
                name: 'mode',
                description: 'Toggle bot mode',
                usage: '.mode [public|private]',
                permissions: 'owner',
                ui: {
                    processingText: '⚙️ Toggling mode...',
                    errorText: '❌ Mode change failed'
                },
                execute: this.toggleMode.bind(this)
            },
            {
                name: 'ban',
                description: 'Ban a user',
                usage: '.ban <number>',
                permissions: 'owner',
                ui: {
                    processingText: '🚫 Banning user...',
                    errorText: '❌ Failed to ban user'
                },
                execute: this.banUser.bind(this)
            },
            {
                name: 'unban',
                description: 'Unban a user',
                usage: '.unban <number>',
                permissions: 'owner',
                ui: {
                    processingText: '✅ Unbanning user...',
                    errorText: '❌ Failed to unban user'
                },
                execute: this.unbanUser.bind(this)
            },
            {
                name: 'broadcast',
                description: 'Broadcast message to all chats',
                usage: '.broadcast <message>',
                permissions: 'owner',
                ui: {
                    processingText: '📢 Sending broadcast...',
                    errorText: '❌ Broadcast failed'
                },
                execute: this.broadcast.bind(this)
            },
            {
                name: 'update',
                description: 'Pull latest updates from Git',
                usage: '.update',
                permissions: 'owner',
                ui: {
                    processingText: '📥 Updating code...',
                    errorText: '❌ Update failed'
                },
                execute: this.updateCode.bind(this)
            },
            {
                name: 'sh',
                description: 'Execute a shell command',
                usage: '.sh <command>',
                permissions: 'owner',
                ui: {
                    processingText: '🖥️ Running shell command...',
                    errorText: '❌ Shell command failed'
                },
                execute: this.runShell.bind(this)
            }
        ];

        this.commandCounts = new Map();
        this.startTime = Date.now();
    }

    async ping(msg, params, context) {
        const start = Date.now();
        const latency = Date.now() - start;
        this.incrementCommandCount('ping');
      return ` *Pong!* • ${latency}ms`;

    }

    async status(msg, params, context) {
        const uptime = this.getUptime();
        const totalCommands = [...this.commandCounts.values()].reduce((a, b) => a + b, 0);
        const text = `🤖 *${config.get('bot.name')} Status*\n\n` +
                     `🆚 Version: ${config.get('bot.version')}\n` +
                     `👤 Owner: ${config.get('bot.owner').split('@')[0]}\n` +
                     `⏰ Uptime: ${uptime}\n` +
                     `📊 Commands Executed: ${totalCommands}\n` +
                     `🌐 Mode: ${config.get('features.mode')}\n` +
                     `🔗 Telegram Bridge: ${config.get('telegram.enabled') ? 'Enabled' : 'Disabled'}\n` +
                     `📞 Contacts Synced: ${this.bot.telegramBridge?.contactMappings.size || 0}`;
        this.incrementCommandCount('status');
        return text;
    }

async restart(msg, params, context) {
    this.incrementCommandCount('restart');

    // Optional: log to Telegram before exit
    if (this.bot.telegramBridge) {
        await this.bot.telegramBridge.logToTelegram('🔄 Bot Restart', 'Restart requested by owner.');
    }

    // Force exit after short delay
    setTimeout(() => process.exit(0), 1000);

    return '🔁 Restarting process...';
}


    async toggleMode(msg, params, context) {
        const mode = params[0]?.toLowerCase();
        if (!['public', 'private'].includes(mode)) {
            return `🌐 Current Mode: ${config.get('features.mode')}\n\nUsage: \`.mode public|private\``;
        }

        config.set('features.mode', mode);
        this.incrementCommandCount('mode');
        if (this.bot.telegramBridge) {
            await this.bot.telegramBridge.logToTelegram('🌐 Mode Changed', `New mode: ${mode}`);
        }
        return `✅ *Mode Changed*\n\nNew Mode: ${mode}`;
    }

    async banUser(msg, params, context) {
        const phone = (params[0] || '').replace('+', '');
        if (!phone) return '❌ Usage: `.ban <number>`';
        const list = config.get('security.blockedUsers') || [];
        if (list.includes(phone)) return `❌ User ${phone} is already banned.`;

        list.push(phone);
        config.set('security.blockedUsers', list);
        this.incrementCommandCount('ban');

        if (this.bot.telegramBridge) {
            await this.bot.telegramBridge.logToTelegram('🚫 User Banned', phone);
        }
        return `🚫 *User Banned*\n\n📱 ${phone}`;
    }

    async unbanUser(msg, params, context) {
        const phone = (params[0] || '').replace('+', '');
        if (!phone) return '❌ Usage: `.unban <number>`';
        const list = config.get('security.blockedUsers') || [];
        if (!list.includes(phone)) return `❌ User ${phone} is not banned.`;

        config.set('security.blockedUsers', list.filter(p => p !== phone));
        this.incrementCommandCount('unban');

        if (this.bot.telegramBridge) {
            await this.bot.telegramBridge.logToTelegram('✅ User Unbanned', phone);
        }
        return `✅ *User Unbanned*\n\n📱 ${phone}`;
    }

    async broadcast(msg, params, context) {
        const text = params.join(' ');
        if (!text) return '❌ Usage: `.broadcast <message>`';

        const chats = this.bot.telegramBridge?.chatMappings.keys() || [];
        let sent = 0;
        for (const jid of chats) {
            try {
                await this.bot.sendMessage(jid, { text: `📢 *Broadcast*\n\n${text}` });
                sent++;
            } catch (e) {
                this.bot.logger?.error?.(`Broadcast failed to ${jid}`, e);
            }
        }

        this.incrementCommandCount('broadcast');
        if (this.bot.telegramBridge) {
            await this.bot.telegramBridge.logToTelegram('📢 Broadcast Sent', `${text} (${sent} chats)`);
        }
        return `📢 *Broadcast Sent*\n\nSent to ${sent} chats.`;
    }

    async updateCode(msg, params, context) {
        return new Promise((resolve, reject) => {
            exec('git pull', async (err, stdout, stderr) => {
                if (err || stderr) {
                    return reject(stderr || err.message);
                }

                if (this.bot.telegramBridge) {
                    await this.bot.telegramBridge.logToTelegram('📥 Update Pulled', stdout);
                }

                this.incrementCommandCount('update');
                resolve(`📥 *Update Complete*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``);
            });
        });
    }

    async runShell(msg, params, context) {
        const command = params.join(' ');
        if (!command) return '❌ Usage: `.sh <command>`';
        return new Promise((resolve, reject) => {
            exec(command, { timeout: 10000 }, (err, stdout, stderr) => {
                if (err || stderr) {
                    return reject(stderr || err.message);
                }
                this.incrementCommandCount('sh');
                resolve(`🖥️ *Command Output*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``);
            });
        });
    }

    getUptime() {
        const sec = Math.floor((Date.now() - this.startTime) / 1000);
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return `${d}d ${h}h ${m}m ${s}s`;
    }

    incrementCommandCount(name) {
        this.commandCounts.set(name, (this.commandCounts.get(name) || 0) + 1);
    }
}

module.exports = CoreModule;
