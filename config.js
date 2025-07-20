class Config {
constructor() {
    this.defaultConfig = {
        bot: {
            name: 'HyperWa',
            company: 'Dawium Technologies',
            prefix: '.',
            version: '2.0.0',
            owner: '923417033005@s.whatsapp.net',
            clearAuthOnStart: false
        },
          auth: {
                useMongoAuth: true, //  set to false for file-based auth, ture mongodb auth base
     },
        admins: [
            '923075417411',  // Just the number part, no "@s.whatsapp.net"
            '923334445555'
        ],  

        // Feature toggles and configurations
        features: {
            mode: 'public', // Bot mode: 'public' or 'private'
            autoViewStatus: false, // Automatically view WhatsApp status updates
            customModules: true, // Enable loading of custom modules
            rateLimiting: true, // Enable command rate limiting
            telegramBridge: true, // Enable Telegram bridge integration
            smartProcessing: true, // Enable smart message processing
            editMessages: true, // Allow editing of sent messages
            autoReact: true, // Auto react to commands
            respondToUnknownCommands: false,  // Bot send error message on wrong commands
            sendPermissionError: false      // bot will send error message on comnd which are not allowed to users
        },
            mongo: {
                uri: 'mongodb+srv://itxelijah07:ivp8FYGsbVfjQOkj@cluster0.wh25x.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
                dbName: 'HyperWALex'
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
                    welcomeMessage: false,       // set to false to disable welcome message sent when topic created
                    sendOutgoingMessages: false,  // set to false to stop forwarding myside messages
                    presenceUpdates: true,
                    readReceipts: false,
                    animatedStickers: true
                }
            },
            logging: {
                level: 'info',
                saveToFile: true,
                maxFileSize: '10MB',
                maxFiles: 5
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
