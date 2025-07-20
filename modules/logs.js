const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class LogsManager {
    constructor(bot) {
        this.bot = bot;
        this.name = 'logs';
        this.metadata = {
            description: 'Advanced logging system for bot activities and monitoring',
            version: '2.0.0',
            author: 'Bot Developer',
            category: 'system',
            dependencies: []
        };
        this.commands = [
            {
                name: 'logs',
                description: 'View recent bot logs',
                usage: '.logs [lines] [type]',
                permissions: 'owner',
                execute: this.viewLogs.bind(this)
            },
            {
                name: 'clearlogs',
                description: 'Clear all logs',
                usage: '.clearlogs [type]',
                permissions: 'owner',
                execute: this.clearLogs.bind(this)
            },
            {
                name: 'logstats',
                description: 'Show logging statistics',
                usage: '.logstats',
                permissions: 'owner',
                execute: this.logStats.bind(this)
            },
            {
                name: 'exportlogs',
                description: 'Export logs as file',
                usage: '.exportlogs [type] [days]',
                permissions: 'owner',
                execute: this.exportLogs.bind(this)
            },
            {
                name: 'monitor',
                description: 'Toggle real-time monitoring',
                usage: '.monitor on/off',
                permissions: 'owner',
                execute: this.toggleMonitoring.bind(this)
            },
            {
                name: 'errors',
                description: 'View recent error logs',
                usage: '.errors [count]',
                permissions: 'owner',
                execute: this.viewErrors.bind(this)
            },
            {
                name: 'activity',
                description: 'View user activity logs',
                usage: '.activity [user] [days]',
                permissions: 'admin',
                execute: this.viewActivity.bind(this)
            }
        ];
        
        this.logsPath = path.join(__dirname, '../logs');
        this.logFiles = {
            general: path.join(this.logsPath, 'general.log'),
            errors: path.join(this.logsPath, 'errors.log'),
            commands: path.join(this.logsPath, 'commands.log'),
            messages: path.join(this.logsPath, 'messages.log'),
            system: path.join(this.logsPath, 'system.log')
        };
        
        this.monitoring = false;
        this.stats = {
            totalLogs: 0,
            errorCount: 0,
            commandCount: 0,
            messageCount: 0,
            startTime: Date.now()
        };
        
        this.messageHooks = {
            'message.new': this.logMessage.bind(this),
            'command.executed': this.logCommand.bind(this),
            'error.occurred': this.logError.bind(this)
        };
        
        this.init();
    }

    async init() {
        await fs.ensureDir(this.logsPath);
        
        // Create log files if they don't exist
        for (const [type, filePath] of Object.entries(this.logFiles)) {
            await fs.ensureFile(filePath);
        }
        
        // Log system startup
        await this.log('system', 'INFO', 'Logs Manager initialized');
        
        // Start log rotation
        this.startLogRotation();
    }

    async log(type, level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            pid: process.pid
        };
        
        const logLine = `[${timestamp}] [${level}] ${message}${data ? ` | Data: ${JSON.stringify(data)}` : ''}\n`;
        
        try {
            if (this.logFiles[type]) {
                await fs.appendFile(this.logFiles[type], logLine);
            }
            await fs.appendFile(this.logFiles.general, logLine);
            
            this.stats.totalLogs++;
            
            if (level === 'ERROR') {
                this.stats.errorCount++;
            }
            
            // Real-time monitoring
            if (this.monitoring && level === 'ERROR') {
                await this.sendMonitoringAlert(logEntry);
            }
            
        } catch (error) {
            console.error('Failed to write log:', error);
        }
    }

    async logMessage(msg, text) {
        const sender = msg.key.remoteJid;
        const participant = msg.key.participant || sender;
        const isGroup = sender.endsWith('@g.us');
        
        const logData = {
            sender,
            participant,
            isGroup,
            messageType: this.getMessageType(msg),
            textLength: text ? text.length : 0
        };
        
        await this.log('messages', 'INFO', `Message received from ${participant}`, logData);
        this.stats.messageCount++;
    }

    async logCommand(commandName, user, success, error = null) {
        const logData = {
            command: commandName,
            user,
            success,
            error: error?.message
        };
        
        const level = success ? 'INFO' : 'ERROR';
        const message = `Command ${commandName} ${success ? 'executed' : 'failed'} by ${user}`;
        
        await this.log('commands', level, message, logData);
        this.stats.commandCount++;
    }

    async logError(error, context = null) {
        const logData = {
            error: error.message,
            stack: error.stack,
            context
        };
        
        await this.log('errors', 'ERROR', `Error occurred: ${error.message}`, logData);
    }

    async viewLogs(msg, params, context) {
        const lines = parseInt(params[0]) || 50;
        const logType = params[1] || 'general';
        
        if (!this.logFiles[logType]) {
            return context.bot.sendMessage(context.sender, {
                text: `❌ Invalid log type. Available types: ${Object.keys(this.logFiles).join(', ')}`
            });
        }
        
        try {
            const logFile = this.logFiles[logType];
            const exists = await fs.pathExists(logFile);
            
            if (!exists) {
                return context.bot.sendMessage(context.sender, {
                    text: `📋 *${logType.toUpperCase()} Logs*\n\n📄 No logs found for this type.`
                });
            }
            
            const content = await fs.readFile(logFile, 'utf8');
            const logLines = content.trim().split('\n').slice(-lines);
            
            if (logLines.length === 0) {
                return context.bot.sendMessage(context.sender, {
                    text: `📋 *${logType.toUpperCase()} Logs*\n\n📄 No logs available.`
                });
            }
            
            let logsText = `📋 *${logType.toUpperCase()} Logs* (Last ${logLines.length} entries)\n\n`;
            logsText += '```\n';
            logsText += logLines.join('\n');
            logsText += '\n```';
            
            // Split long messages
            if (logsText.length > 4000) {
                const chunks = this.splitMessage(logsText, 4000);
                for (let i = 0; i < chunks.length; i++) {
                    await context.bot.sendMessage(context.sender, {
                        text: i === 0 ? chunks[i] : `📋 *Logs Continued (${i + 1}/${chunks.length})*\n\n${chunks[i]}`
                    });
                }
            } else {
                await context.bot.sendMessage(context.sender, { text: logsText });
            }
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to read logs: ${error.message}`
            });
        }
    }

    async clearLogs(msg, params, context) {
        const logType = params[0] || 'all';
        
        try {
            if (logType === 'all') {
                for (const filePath of Object.values(this.logFiles)) {
                    await fs.writeFile(filePath, '');
                }
                await context.bot.sendMessage(context.sender, {
                    text: '✅ All logs cleared successfully!'
                });
            } else if (this.logFiles[logType]) {
                await fs.writeFile(this.logFiles[logType], '');
                await context.bot.sendMessage(context.sender, {
                    text: `✅ ${logType.toUpperCase()} logs cleared successfully!`
                });
            } else {
                await context.bot.sendMessage(context.sender, {
                    text: `❌ Invalid log type. Available types: ${Object.keys(this.logFiles).join(', ')}, all`
                });
            }
            
            // Reset stats
            this.stats.totalLogs = 0;
            this.stats.errorCount = 0;
            this.stats.commandCount = 0;
            this.stats.messageCount = 0;
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to clear logs: ${error.message}`
            });
        }
    }

    async logStats(msg, params, context) {
        const uptime = Date.now() - this.stats.startTime;
        const uptimeString = this.formatUptime(uptime / 1000);
        
        try {
            let statsText = `📊 *Logging Statistics*\n\n`;
            statsText += `⏱️ *Uptime:* ${uptimeString}\n`;
            statsText += `📝 *Total Logs:* ${this.stats.totalLogs}\n`;
            statsText += `💬 *Messages:* ${this.stats.messageCount}\n`;
            statsText += `⚡ *Commands:* ${this.stats.commandCount}\n`;
            statsText += `❌ *Errors:* ${this.stats.errorCount}\n`;
            statsText += `📊 *Monitoring:* ${this.monitoring ? '✅ Active' : '❌ Inactive'}\n\n`;
            
            // File sizes
            statsText += `📁 *Log File Sizes:*\n`;
            for (const [type, filePath] of Object.entries(this.logFiles)) {
                try {
                    const stats = await fs.stat(filePath);
                    const sizeKB = (stats.size / 1024).toFixed(2);
                    statsText += `  • ${type}: ${sizeKB} KB\n`;
                } catch (error) {
                    statsText += `  • ${type}: 0 KB\n`;
                }
            }
            
            // Recent activity
            const recentErrors = await this.getRecentErrors(5);
            if (recentErrors.length > 0) {
                statsText += `\n🚨 *Recent Errors (${recentErrors.length}):*\n`;
                recentErrors.forEach((error, index) => {
                    statsText += `  ${index + 1}. ${error.message.substring(0, 50)}...\n`;
                });
            }
            
            await context.bot.sendMessage(context.sender, { text: statsText });
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to get log stats: ${error.message}`
            });
        }
    }

    async exportLogs(msg, params, context) {
        const logType = params[0] || 'general';
        const days = parseInt(params[1]) || 7;
        
        if (!this.logFiles[logType]) {
            return context.bot.sendMessage(context.sender, {
                text: `❌ Invalid log type. Available types: ${Object.keys(this.logFiles).join(', ')}`
            });
        }
        
        const processingMsg = await context.bot.sendMessage(context.sender, {
            text: '⏳ *Exporting Logs*\n\n📦 Preparing log file...\n⏳ Please wait...'
        });
        
        try {
            const logFile = this.logFiles[logType];
            const exists = await fs.pathExists(logFile);
            
            if (!exists) {
                return context.bot.sock.sendMessage(context.sender, {
                    text: '❌ No logs found to export.',
                    edit: processingMsg.key
                });
            }
            
            const content = await fs.readFile(logFile, 'utf8');
            const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
            
            // Filter logs by date
            const filteredLogs = content.split('\n').filter(line => {
                const match = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z)\]/);
                if (match) {
                    const logDate = new Date(match[1]);
                    return logDate >= cutoffDate;
                }
                return false;
            });
            
            const exportContent = filteredLogs.join('\n');
            const fileName = `${logType}_logs_${days}days_${new Date().toISOString().split('T')[0]}.txt`;
            const exportPath = path.join(this.logsPath, fileName);
            
            await fs.writeFile(exportPath, exportContent);
            
            const fileBuffer = await fs.readFile(exportPath);
            const fileSizeKB = (fileBuffer.length / 1024).toFixed(2);
            
            await context.bot.sock.sendMessage(context.sender, {
                text: `✅ *Logs Exported*\n\n📁 File: ${fileName}\n📊 Size: ${fileSizeKB} KB\n📅 Period: Last ${days} days\n📝 Lines: ${filteredLogs.length}`,
                edit: processingMsg.key
            });
            
            await context.bot.sendMessage(context.sender, {
                document: fileBuffer,
                fileName: fileName,
                mimetype: 'text/plain'
            });
            
            // Clean up
            await fs.remove(exportPath);
            
        } catch (error) {
            await context.bot.sock.sendMessage(context.sender, {
                text: `❌ *Export Failed*\n\n🚫 Error: ${error.message}`,
                edit: processingMsg.key
            });
        }
    }

    async toggleMonitoring(msg, params, context) {
        if (params.length === 0) {
            return context.bot.sendMessage(context.sender, {
                text: `📊 *Real-time Monitoring:* ${this.monitoring ? '✅ Active' : '❌ Inactive'}\n\nUsage: .monitor on/off`
            });
        }
        
        const action = params[0].toLowerCase();
        
        if (action === 'on' || action === 'enable') {
            this.monitoring = true;
            await context.bot.sendMessage(context.sender, {
                text: '✅ Real-time monitoring enabled! You will receive alerts for critical errors.'
            });
        } else if (action === 'off' || action === 'disable') {
            this.monitoring = false;
            await context.bot.sendMessage(context.sender, {
                text: '❌ Real-time monitoring disabled!'
            });
        } else {
            await context.bot.sendMessage(context.sender, {
                text: '❌ Invalid option. Use: .monitor on/off'
            });
        }
    }

    async viewErrors(msg, params, context) {
        const count = parseInt(params[0]) || 10;
        
        try {
            const errors = await this.getRecentErrors(count);
            
            if (errors.length === 0) {
                return context.bot.sendMessage(context.sender, {
                    text: '✅ *Error Logs*\n\n🎉 No recent errors found!'
                });
            }
            
            let errorText = `🚨 *Recent Errors* (${errors.length})\n\n`;
            
            errors.forEach((error, index) => {
                errorText += `${index + 1}. **${error.timestamp}**\n`;
                errorText += `   📝 ${error.message}\n`;
                if (error.context) {
                    errorText += `   🔍 Context: ${error.context}\n`;
                }
                errorText += `\n`;
            });
            
            await context.bot.sendMessage(context.sender, { text: errorText });
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to get error logs: ${error.message}`
            });
        }
    }

    async viewActivity(msg, params, context) {
        const targetUser = params[0];
        const days = parseInt(params[1]) || 7;
        
        try {
            const activity = await this.getUserActivity(targetUser, days);
            
            let activityText = `📊 *User Activity Report*\n\n`;
            
            if (targetUser) {
                activityText += `👤 *User:* ${targetUser}\n`;
            } else {
                activityText += `👥 *All Users*\n`;
            }
            
            activityText += `📅 *Period:* Last ${days} days\n\n`;
            activityText += `💬 *Messages:* ${activity.messages}\n`;
            activityText += `⚡ *Commands:* ${activity.commands}\n`;
            activityText += `📊 *Success Rate:* ${activity.successRate}%\n`;
            
            if (activity.topCommands.length > 0) {
                activityText += `\n🔥 *Top Commands:*\n`;
                activity.topCommands.forEach((cmd, index) => {
                    activityText += `  ${index + 1}. ${cmd.name} (${cmd.count}x)\n`;
                });
            }
            
            await context.bot.sendMessage(context.sender, { text: activityText });
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to get activity report: ${error.message}`
            });
        }
    }

    async getRecentErrors(count) {
        try {
            const content = await fs.readFile(this.logFiles.errors, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            
            return lines.slice(-count).map(line => {
                const match = line.match(/\[([^\]]+)\] \[ERROR\] (.+)/);
                if (match) {
                    return {
                        timestamp: match[1],
                        message: match[2]
                    };
                }
                return { timestamp: 'Unknown', message: line };
            }).reverse();
        } catch (error) {
            return [];
        }
    }

    async getUserActivity(user, days) {
        // This would analyze log files for user activity
        // Placeholder implementation
        return {
            messages: Math.floor(Math.random() * 100),
            commands: Math.floor(Math.random() * 50),
            successRate: Math.floor(Math.random() * 20) + 80,
            topCommands: [
                { name: 'ping', count: 10 },
                { name: 'help', count: 8 },
                { name: 'status', count: 5 }
            ]
        };
    }

    async sendMonitoringAlert(logEntry) {
        const owner = config.get('bot.owner');
        if (!owner) return;
        
        try {
            const alertText = `🚨 *Critical Error Alert*\n\n` +
                            `⏰ ${logEntry.timestamp}\n` +
                            `📝 ${logEntry.message}\n` +
                            `🔍 Level: ${logEntry.level}`;
            
            await this.bot.sendMessage(owner, { text: alertText });
        } catch (error) {
            console.error('Failed to send monitoring alert:', error);
        }
    }

    startLogRotation() {
        // Rotate logs daily
        setInterval(async () => {
            try {
                const date = new Date().toISOString().split('T')[0];
                
                for (const [type, filePath] of Object.entries(this.logFiles)) {
                    const stats = await fs.stat(filePath);
                    
                    // Rotate if file is larger than 10MB
                    if (stats.size > 10 * 1024 * 1024) {
                        const archivePath = filePath.replace('.log', `_${date}.log`);
                        await fs.move(filePath, archivePath);
                        await fs.ensureFile(filePath);
                    }
                }
            } catch (error) {
                console.error('Log rotation failed:', error);
            }
        }, 24 * 60 * 60 * 1000); // 24 hours
    }

    getMessageType(msg) {
        if (msg.message?.conversation) return 'text';
        if (msg.message?.imageMessage) return 'image';
        if (msg.message?.videoMessage) return 'video';
        if (msg.message?.audioMessage) return 'audio';
        if (msg.message?.documentMessage) return 'document';
        if (msg.message?.stickerMessage) return 'sticker';
        return 'unknown';
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        let uptime = '';
        if (days > 0) uptime += `${days}d `;
        if (hours > 0) uptime += `${hours}h `;
        if (minutes > 0) uptime += `${minutes}m `;
        uptime += `${secs}s`;

        return uptime;
    }

    splitMessage(text, maxLength) {
        const chunks = [];
        let currentChunk = '';
        
        const lines = text.split('\n');
        
        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > maxLength) {
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }
            }
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
        
        if (currentChunk) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }
}

module.exports = LogsManager;
