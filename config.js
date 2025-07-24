class Config {
    constructor() {
        this.defaultConfig = {
            bot: {
                name: 'HyperWa',
                company: 'Dawium Technologies',
                prefix: '.',
                version: '2.0.0',
                owner: '923417033005@s.whatsapp.net', // Include full JID
                clearAuthOnStart: false
            },

            auth: {
                useMongoAuth: true // Set to false for file-based auth
            },

            admins: [
                '923075417411', // Just the number part, no "@s.whatsapp.net"
                '923334445555'
            ],

            // Feature toggles and options
            features: {
                mode: 'public',                   // 'public' or 'private'
                customModules: true,              // Enable custom modules
                rateLimiting: true,               // Enable rate limiting
                telegramBridge: true,             // Sync with Telegram
                respondToUnknownCommands: false, // Respond to unknown commands
                sendPermissionError: false        // Send error for disallowed commands
            },

            mongo: {
                uri: 'mongodb+srv://itxelijah07:ivp8FYGsbVfjQOkj@cluster0.wh25x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
                dbName: 'HyperWA'
            },

            telegram: {
                enabled: true,
                botToken: '7822179405:AAHI1zW7qkXZsqOtyu9NeRdmquwbx1aZu0o',
                botPassword: '1122',
                chatId: '-1002783833178',
                logChannel: '-100000000000',
                features: {
                    topics: true,
                    mediaSync: true,
                    profilePicSync: false,
                    callLogs: true,
                    statusSync: true,
                    biDirectional: true,
                    welcomeMessage: false,         // Message on topic creation
                    sendOutgoingMessages: false,   // Forward messages from this side
                    presenceUpdates: true,
                    readReceipts: false,
                    animatedStickers: true
                }
            },

            help: {
                // Default help style:
                // 1 = Box style (╔══ module ══)
                // 2 = Divider style (██▓▒░ module)
                defaultStyle: 1,

                // Default display mode for commands:
                // "description" = show command descriptions
                // "usage" = show usage string
                // "none" = show only command names
                defaultShow: 'description'
            },

            logging: {
                level: 'info',        // Log level: info, warn, error, debug
                saveToFile: true,     // Write logs to file
                maxFileSize: '10MB',  // Max size per log file
                maxFiles: 5           // Max number of rotated files
            }
        };

        this.load();
    }

    load() {
        this.config = { ...this.defaultConfig };
        console.log('✅ Configuration loaded');
    }

    get(key) {
        return key.split('.').reduce((o, k) => o && o[k], this.config);
    }

    set(key, value) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((o, k) => {
            if (typeof o[k] === 'undefined') o[k] = {};
            return o[k];
        }, this.config);
        target[lastKey] = value;
        console.warn(`⚠️ Config key '${key}' was set to '${value}' (in-memory only).`);
    }

    update(updates) {
        this.config = { ...this.config, ...updates };
        console.warn('⚠️ Config was updated in memory. Not persistent.');
    }
}

module.exports = new Config();
