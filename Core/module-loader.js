const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');
const config = require('../config');
const helpers = require('../utils/helpers');

// Enhanced in-memory store with better isolation
const helpPreferences = new Map();
const moduleExecutionContexts = new Map(); // Track module execution contexts

class ModuleLoader {
    constructor(bot) {
        this.bot = bot;
        this.modules = new Map();
        this.systemModulesCount = 0;
        this.customModulesCount = 0;
        this.moduleStats = new Map(); // Track module usage stats
        this.setupModuleCommands();
    }

    setupModuleCommands() {
        // Enhanced Load Module Command with better error handling
        const loadModuleCommand = {
            name: 'lm',
            description: 'Load a module from file',
            usage: '.lm (reply to a .js or .mjs file)',
            permissions: 'owner',
            ui: {
                processingText: '⚡ Loading module...',
                errorText: '❌ Module load failed'
            },
            execute: async (msg, params, context) => {
                const fileName = msg.message?.documentMessage?.fileName;
                if (!fileName || (!fileName.endsWith('.js') && !fileName.endsWith('.mjs'))) {
                    return context.bot.sendMessage(context.sender, {
                        text: '🔧 *Load Module*\n\n❌ Please reply to a JavaScript (.js or .mjs) file to load it as a module.'
                    });
                }

                try {
                    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                    const stream = await downloadContentFromMessage(msg.message.documentMessage, 'document');
                    
                    const chunks = [];
                    for await (const chunk of stream) {
                        chunks.push(chunk);
                    }
                    const buffer = Buffer.concat(chunks);
                    
                    // Use user's working directory for isolation
                    const customModulesPath = context.userContext 
                        ? context.userContext.getWorkingPath('custom_modules')
                        : path.join(__dirname, '../custom_modules');
                    
                    await fs.ensureDir(customModulesPath);
                    
                    const filePath = path.join(customModulesPath, fileName);
                    await fs.writeFile(filePath, buffer);
                    
                    // Load module with enhanced error handling
                    const result = await this.loadModule(filePath, false, context.userContext);
                    
                    if (result.success) {
                        return context.bot.sendMessage(context.sender, {
                            text: `✅ *Module Loaded Successfully*\n\n📦 Module: \`${fileName}\`\n📁 Location: Custom Modules\n🎯 Status: Active\n⏰ ${new Date().toLocaleTimeString()}`
                        });
                    } else {
                        throw new Error(result.error);
                    }

                } catch (error) {
                    logger.error('Failed to load module:', error);
                    throw error; // Let the enhanced error handler deal with it
                }
            }
        };

        // Enhanced Unload Module Command
        const unloadModuleCommand = {
            name: 'ulm',
            description: 'Unload a module',
            usage: '.ulm <module_name>',
            permissions: 'owner',
            ui: {
                processingText: '⚡ Unloading module...',
                errorText: '❌ Module unload failed'
            },
            execute: async (msg, params, context) => {
                if (params.length === 0) {
                    const moduleList = this.listModules().join('\n• ');
                    return context.bot.sendMessage(context.sender, {
                        text: `🔧 *Unload Module*\n\n📋 Available modules:\n• ${moduleList}\n\n💡 Usage: \`.ulm <module_name>\``
                    });
                }

                const moduleName = params[0];
                
                try {
                    await this.unloadModule(moduleName);
                    
                    return context.bot.sendMessage(context.sender, {
                        text: `✅ *Module Unloaded Successfully*\n\n📦 Module: \`${moduleName}\`\n🗑️ Status: Removed\n⏰ ${new Date().toLocaleTimeString()}`
                    });

                } catch (error) {
                    logger.error('Failed to unload module:', error);
                    throw error;
                }
            }
        };

        // Enhanced List Modules Command with stats
        const listModulesCommand = {
            name: 'modules',
            description: 'List all loaded modules with statistics',
            usage: '.modules',
            permissions: 'public',
            execute: async (msg, params, context) => {
                const systemModules = [];
                const customModules = [];
                
                for (const [name, moduleInfo] of this.modules) {
                    const stats = this.moduleStats.get(name) || { uses: 0, lastUsed: null };
                    const moduleEntry = {
                        name,
                        uses: stats.uses,
                        lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toLocaleString() : 'Never'
                    };
                    
                    if (moduleInfo.isSystem) {
                        systemModules.push(moduleEntry);
                    } else {
                        customModules.push(moduleEntry);
                    }
                }

                let moduleText = `🔧 *Loaded Modules*\n\n`;
                
                moduleText += `📊 **System Modules (${systemModules.length}):**\n`;
                if (systemModules.length > 0) {
                    for (const mod of systemModules) {
                        moduleText += `• **${mod.name}** - Used: ${mod.uses} times\n`;
                    }
                    moduleText += '\n';
                } else {
                    moduleText += `• None loaded\n\n`;
                }
                
                moduleText += `🎨 **Custom Modules (${customModules.length}):**\n`;
                if (customModules.length > 0) {
                    for (const mod of customModules) {
                        moduleText += `• **${mod.name}** - Used: ${mod.uses} times\n`;
                    }
                    moduleText += '\n';
                } else {
                    moduleText += `• None loaded\n\n`;
                }
                
                moduleText += `📈 **Total:** ${this.modules.size} modules active\n`;
                moduleText += `🔥 **Most Used:** ${this.getMostUsedModule()}`;

                await context.bot.sendMessage(context.sender, { text: moduleText });
            }
        };

        // Register module management commands
        this.bot.messageHandler.registerCommandHandler('lm', loadModuleCommand);
        this.bot.messageHandler.registerCommandHandler('ulm', unloadModuleCommand);
        this.bot.messageHandler.registerCommandHandler('modules', listModulesCommand);
    }

    getMostUsedModule() {
        let mostUsed = { name: 'None', uses: 0 };
        
        for (const [name, stats] of this.moduleStats) {
            if (stats.uses > mostUsed.uses) {
                mostUsed = { name, uses: stats.uses };
            }
        }
        
        return `${mostUsed.name} (${mostUsed.uses} uses)`;
    }

    async loadModules() {
        const systemPath = path.join(__dirname, '../modules');
        const customPath = path.join(__dirname, '../modules/custom_modules');

        await fs.ensureDir(systemPath);
        await fs.ensureDir(customPath);

        try {
            const [systemFiles, customFiles] = await Promise.all([
                fs.readdir(systemPath),
                fs.readdir(customPath)
            ]);

            this.systemModulesCount = 0;
            this.customModulesCount = 0;

            // Load system modules
            for (const file of systemFiles) {
                if (file.endsWith('.js')) {
                    const result = await this.loadModule(path.join(systemPath, file), true);
                    if (result.success) {
                        logger.debug(`✅ Loaded system module: ${file}`);
                    } else {
                        logger.warn(`⚠️ Failed to load system module ${file}: ${result.error}`);
                    }
                }
            }

            // Load custom modules
            for (const file of customFiles) {
                if (file.endsWith('.js')) {
                    const result = await this.loadModule(path.join(customPath, file), false);
                    if (result.success) {
                        logger.debug(`✅ Loaded custom module: ${file}`);
                    } else {
                        logger.warn(`⚠️ Failed to load custom module ${file}: ${result.error}`);
                    }
                }
            }

            logger.info(`Modules Loaded || 🧩 System: ${this.systemModulesCount} || 📦 Custom: ${this.customModulesCount} || 📊 Total: ${this.systemModulesCount + this.customModulesCount}`);

            // Load help system after all modules
            this.setupHelpSystem();

        } catch (error) {
            logger.error('Error loading modules:', error);
        }
    }

    setupHelpSystem() {
        const getUserPermissions = (userId) => {
            const owner = config.get('bot.owner')?.split('@')[0];
            const isOwner = owner === userId;
            const admins = config.get('bot.admins') || [];
            const isAdmin = admins.includes(userId);
            return isOwner ? ['public', 'admin', 'owner'] : isAdmin ? ['public', 'admin'] : ['public'];
        };

        const helpCommand = {
            name: 'help',
            description: 'Show available commands or help for a module',
            usage: '.help [module_name] | .help 1|2 | .help show 1|2|3',
            permissions: 'public',
            execute: async (msg, params, context) => {
                const userId = context.sender.split('@')[0];
                const userPerms = getUserPermissions(userId);

                const helpConfig = config.get('help') || {};
                const defaultStyle = helpConfig.defaultStyle || 1;
                const defaultShow = helpConfig.defaultShow || 'description';
                const pref = helpPreferences.get(userId) || { style: defaultStyle, show: defaultShow };

                // Handle style switches
                if (params.length === 1 && ['1', '2'].includes(params[0])) {
                    pref.style = Number(params[0]);
                    helpPreferences.set(userId, pref);
                    await context.bot.sendMessage(context.sender, {
                        text: `✅ Help style set to *${pref.style}*`
                    });
                    return;
                }

                // Handle show options
                if (params.length === 2 && params[0] === 'show') {
                    const map = { '1': 'description', '2': 'usage', '3': 'none' };
                    if (!map[params[1]]) {
                        return await context.bot.sendMessage(context.sender, {
                            text: `❌ Invalid show option.\nUse:\n.help show 1 (description)\n.help show 2 (usage)\n.help show 3 (none)`
                        });
                    }
                    pref.show = map[params[1]];
                    helpPreferences.set(userId, pref);
                    return await context.bot.sendMessage(context.sender, {
                        text: `✅ Help display mode set to *${pref.show}*`
                    });
                }

                // Handle specific module help
                if (params.length === 1) {
                    const moduleName = params[0].toLowerCase();
                    const moduleInfo = this.getModule(moduleName);

                    if (!moduleInfo) {
                        return await context.bot.sendMessage(context.sender, {
                            text: `❌ Module *${moduleName}* not found.\nUse *.help* to view available modules.`
                        });
                    }

                    const commands = Array.isArray(moduleInfo.commands) ? moduleInfo.commands : [];
                    const visibleCommands = commands.filter(cmd => {
                        const perms = Array.isArray(cmd.permissions) ? cmd.permissions : [cmd.permissions];
                        return perms.some(p => userPerms.includes(p));
                    });

                    let out = '';
                    if (pref.style === 2) {
                        out += `██▓▒░ *${moduleName}*\n\n`;
                        for (const cmd of visibleCommands) {
                            const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                            if (pref.show === 'none') {
                                out += `  ↳ *${cmd.name}*\n`;
                            } else {
                                out += `  ↳ *${cmd.name}*: ${info}\n`;
                            }
                        }
                    } else {
                        out += `╔══  *${moduleName}* ══\n`;
                        for (const cmd of visibleCommands) {
                            const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                            if (pref.show === 'none') {
                                out += `║ *${cmd.name}*\n`;
                            } else {
                                out += `║ *${cmd.name}* – ${info}\n`;
                            }
                        }
                        out += `╚═══════════════`;
                    }

                    return await context.bot.sendMessage(context.sender, { text: out });
                }

                // Render all modules help
                const systemModules = [];
                const customModules = [];

                for (const [name, moduleInfo] of this.modules) {
                    const entry = { name, instance: moduleInfo.instance };
                    moduleInfo.isSystem ? systemModules.push(entry) : customModules.push(entry);
                }

                const renderModuleBlock = (modules) => {
                    let block = '';
                    for (const mod of modules) {
                        const commands = Array.isArray(mod.instance.commands) ? mod.instance.commands : [];
                        const visible = commands.filter(c => {
                            const perms = Array.isArray(c.permissions) ? c.permissions : [c.permissions];
                            return perms.some(p => userPerms.includes(p));
                        });
                        if (visible.length === 0) continue;

                        if (pref.style === 2) {
                            block += `██▓▒░ *${mod.name}*\n\n`;
                            for (const cmd of visible) {
                                const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                                if (pref.show === 'none') {
                                    block += `  ↳ *${cmd.name}*\n`;
                                } else {
                                    block += `  ↳ *${cmd.name}*: ${info}\n`;
                                }
                            }
                            block += `\n`;
                        } else {
                            block += `╔══  *${mod.name}* ══\n`;
                            for (const cmd of visible) {
                                const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                                if (pref.show === 'none') {
                                    block += `║ *${cmd.name}*\n`;
                                } else {
                                    block += `║ *${cmd.name}* – ${info}\n`;
                                }
                            }
                            block += `╚═══════════════\n\n`;
                        }
                    }
                    return block;
                };

                let helpText = `🤖 *${config.get('bot.name')} Help Menu*\n\n`;
                helpText += renderModuleBlock(systemModules);
                helpText += renderModuleBlock(customModules);
                
                // Add usage stats
                helpText += `\n📊 *Usage Stats:*\n`;
                helpText += `• Most used: ${this.getMostUsedModule()}\n`;
                helpText += `• Total commands available: ${this.getTotalCommandsForUser(userPerms)}`;
                
                await context.bot.sendMessage(context.sender, { text: helpText.trim() });
            }
        };

        this.bot.messageHandler.registerCommandHandler('help', helpCommand);
    }

    getTotalCommandsForUser(userPerms) {
        let total = 0;
        for (const [, moduleInfo] of this.modules) {
            const commands = Array.isArray(moduleInfo.instance.commands) ? moduleInfo.instance.commands : [];
            const visible = commands.filter(c => {
                const perms = Array.isArray(c.permissions) ? c.permissions : [c.permissions];
                return perms.some(p => userPerms.includes(p));
            });
            total += visible.length;
        }
        return total;
    }

    getCommandModule(commandName) {
        for (const [moduleName, moduleInfo] of this.modules) {
            if (moduleInfo.instance.commands) {
                for (const cmd of moduleInfo.instance.commands) {
                    if (cmd.name === commandName) {
                        // Track command usage
                        this.trackModuleUsage(moduleName);
                        return moduleName;
                    }
                }
            }
        }
        return 'Core System';
    }

    trackModuleUsage(moduleName) {
        const stats = this.moduleStats.get(moduleName) || { uses: 0, lastUsed: null };
        stats.uses++;
        stats.lastUsed = Date.now();
        this.moduleStats.set(moduleName, stats);
    }

    async loadModule(filePath, isSystem, userContext = null) {
        const moduleId = path.basename(filePath, '.js');
        
        try {
            // Clear require cache to allow hot reloading
            delete require.cache[require.resolve(filePath)];
            
            const mod = require(filePath);

            // Enhanced module instantiation with error handling
            let moduleInstance;
            
            try {
                moduleInstance = typeof mod === 'function' && /^\s*class\s/.test(mod.toString()) 
                                   ? new mod(this.bot) 
                                   : mod;
            } catch (instantiationError) {
                logger.error(`❌ Failed to instantiate module '${moduleId}':`, instantiationError.message);
                return { success: false, error: `Module instantiation failed: ${instantiationError.message}` };
            }

            const actualModuleId = (moduleInstance && moduleInstance.name) ? moduleInstance.name : moduleId;

            // Validate and enhance module structure
            if (!moduleInstance.metadata) {
                moduleInstance.metadata = {
                    description: 'No description provided',
                    version: '1.0.0',
                    author: 'Unknown',
                    category: 'Uncategorized',
                    dependencies: []
                };
            }

            // Initialize module if it has init method
            if (moduleInstance.init && typeof moduleInstance.init === 'function') {
                try {
                    await moduleInstance.init();
                    logger.debug(`🔧 Initialized module: ${actualModuleId}`);
                } catch (initError) {
                    logger.error(`❌ Module init failed for '${actualModuleId}':`, initError.message);
                    return { success: false, error: `Module initialization failed: ${initError.message}` };
                }
            }

            // Enhanced command registration with user isolation support
            if (Array.isArray(moduleInstance.commands)) {
                for (const cmd of moduleInstance.commands) {
                    if (!cmd.name || !cmd.description || !cmd.usage || !cmd.execute) {
                        logger.warn(`⚠️ Invalid command in module ${actualModuleId}: ${JSON.stringify(cmd)}`);
                        continue;
                    }

                    const ui = cmd.ui || {};
                    const shouldWrap = cmd.ui && (cmd.autoWrap !== false);
                    
                    // Enhanced command wrapper with user isolation
                    const wrappedCmd = shouldWrap ? {
                        ...cmd,
                        execute: async (msg, params, context) => {
                            // Track module usage
                            this.trackModuleUsage(actualModuleId);
                            
                            await helpers.smartErrorRespond(context.bot, msg, {
                                processingText: ui.processingText || `⏳ Running *${cmd.name}*...`,
                                errorText: ui.errorText || `❌ *${cmd.name}* failed.`,
                                actionFn: async () => {
                                    // Enhanced context for user isolation
                                    const enhancedContext = {
                                        ...context,
                                        moduleId: actualModuleId,
                                        modulePath: filePath,
                                        // Add module-specific working directory if user context available
                                        moduleWorkingDir: context.userContext 
                                            ? context.userContext.getWorkingPath(`modules/${actualModuleId}`)
                                            : null
                                    };
                                    
                                    return await cmd.execute(msg, params, enhancedContext);
                                }
                            });
                        }
                    } : {
                        ...cmd,
                        execute: async (msg, params, context) => {
                            // Track module usage even for non-wrapped commands
                            this.trackModuleUsage(actualModuleId);
                            
                            const enhancedContext = {
                                ...context,
                                moduleId: actualModuleId,
                                modulePath: filePath,
                                moduleWorkingDir: context.userContext 
                                    ? context.userContext.getWorkingPath(`modules/${actualModuleId}`)
                                    : null
                            };
                            
                            return await cmd.execute(msg, params, enhancedContext);
                        }
                    };

                    this.bot.messageHandler.registerCommandHandler(cmd.name, wrappedCmd);

                    // Register aliases with enhanced tracking
                    if (cmd.aliases && Array.isArray(cmd.aliases)) {
                        for (const alias of cmd.aliases) {
                            if (alias && typeof alias === 'string') {
                                this.bot.messageHandler.registerCommandHandler(alias, wrappedCmd);
                                logger.debug(`📝 Registered alias: ${alias} -> ${cmd.name}`);
                            }
                        }
                    }
                }
            }

            // Enhanced message hooks registration
            if (moduleInstance.messageHooks && typeof moduleInstance.messageHooks === 'object' && moduleInstance.messageHooks !== null) {
                for (const [hook, fn] of Object.entries(moduleInstance.messageHooks)) {
                    // Wrap message hooks for better error handling
                    const wrappedHook = async (msg, text, bot) => {
                        try {
                            await fn.call(moduleInstance, msg, text, bot);
                        } catch (hookError) {
                            logger.error(`❌ Message hook '${hook}' failed in module '${actualModuleId}':`, hookError.message);
                        }
                    };
                    
                    this.bot.messageHandler.registerMessageHook(hook, wrappedHook);
                    logger.debug(`🪝 Registered message hook: ${hook} (${actualModuleId})`);
                }
            }

            // Store module info with enhanced metadata
            this.modules.set(actualModuleId, {
                instance: moduleInstance,
                path: filePath,
                isSystem,
                loadedAt: new Date(),
                version: moduleInstance.metadata?.version || '1.0.0',
                author: moduleInstance.metadata?.author || 'Unknown'
            });

            // Initialize module stats
            if (!this.moduleStats.has(actualModuleId)) {
                this.moduleStats.set(actualModuleId, { uses: 0, lastUsed: null });
            }

            if (isSystem) {
                this.systemModulesCount++;
            } else {
                this.customModulesCount++;
            }

            logger.debug(`✅ Successfully loaded module: ${actualModuleId}`);
            return { success: true, moduleId: actualModuleId };

        } catch (err) {
            logger.error(`❌ Failed to load module '${moduleId}' from ${filePath}`);
            logger.error(`Error: ${err.message}`);
            logger.debug(err.stack);
            
            return { success: false, error: err.message };
        }
    }

    getModule(name) {
        return this.modules.get(name)?.instance || null;
    }

    getModuleInfo(name) {
        return this.modules.get(name) || null;
    }

    listModules() {
        return [...this.modules.keys()];
    }
    
    async unloadModule(moduleId) {
        const moduleInfo = this.modules.get(moduleId);
        if (!moduleInfo) {
            throw new Error(`Module ${moduleId} not found`);
        }

        try {
            // Call module's destroy method if exists
            if (moduleInfo.instance.destroy && typeof moduleInfo.instance.destroy === 'function') {
                await moduleInfo.instance.destroy();
                logger.debug(`🧹 Destroyed module: ${moduleId}`);
            }

            // Unregister all commands from this module
            if (Array.isArray(moduleInfo.instance.commands)) {
                for (const cmd of moduleInfo.instance.commands) {
                    if (cmd.name) {
                        this.bot.messageHandler.unregisterCommandHandler(cmd.name);
                        
                        // Unregister aliases too
                        if (cmd.aliases && Array.isArray(cmd.aliases)) {
                            for (const alias of cmd.aliases) {
                                if (alias && typeof alias === 'string') {
                                    this.bot.messageHandler.unregisterCommandHandler(alias);
                                }
                            }
                        }
                    }
                }
            }

            // Unregister message hooks
            if (moduleInfo.instance.messageHooks && typeof moduleInfo.instance.messageHooks === 'object') {
                for (const hook of Object.keys(moduleInfo.instance.messageHooks)) {
                    this.bot.messageHandler.unregisterMessageHook(hook);
                }
            }

            // Update counters
            if (moduleInfo.isSystem) {
                this.systemModulesCount = Math.max(0, this.systemModulesCount - 1);
            } else {
                this.customModulesCount = Math.max(0, this.customModulesCount - 1);
            }

            // Remove from maps
            this.modules.delete(moduleId);
            this.moduleStats.delete(moduleId);
            
            // Clear from require cache
            if (moduleInfo.path) {
                delete require.cache[require.resolve(moduleInfo.path)];
            }
            
            logger.info(`🚫 Successfully unloaded module: ${moduleId}`);
            
        } catch (error) {
            logger.error(`❌ Error unloading module ${moduleId}:`, error.message);
            throw error;
        }
    }

    // Enhanced module management methods
    async reloadModule(moduleId) {
        const moduleInfo = this.modules.get(moduleId);
        if (!moduleInfo) {
            throw new Error(`Module ${moduleId} not found`);
        }

        const { path: modulePath, isSystem } = moduleInfo;
        
        // Unload the module
        await this.unloadModule(moduleId);
        
        // Reload it
        const result = await this.loadModule(modulePath, isSystem);
        
        if (!result.success) {
            throw new Error(`Failed to reload module: ${result.error}`);
        }
        
        logger.info(`🔄 Successfully reloaded module: ${moduleId}`);
        return result;
    }

    getModuleStats() {
        return {
            total: this.modules.size,
            system: this.systemModulesCount,
            custom: this.customModulesCount,
            stats: Object.fromEntries(this.moduleStats),
            mostUsed: this.getMostUsedModule()
        };
    }

    // Cleanup method for proper shutdown
    async cleanup() {
        logger.info('🧹 Cleaning up modules...');
        
        for (const [moduleId, moduleInfo] of this.modules) {
            try {
                if (moduleInfo.instance.destroy && typeof moduleInfo.instance.destroy === 'function') {
                    await moduleInfo.instance.destroy();
                }
            } catch (error) {
                logger.warn(`⚠️ Error destroying module ${moduleId}:`, error.message);
            }
        }
        
        this.modules.clear();
        this.moduleStats.clear();
        helpPreferences.clear();
        moduleExecutionContexts.clear();
        
        logger.info('✅ Module cleanup completed');
    }
}

module.exports = ModuleLoader;
