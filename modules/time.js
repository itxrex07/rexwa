const axios = require('axios');

class TimeModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'time';
        this.metadata = {
            description: 'World time and timezone information',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'utility'
        };
        
        this.defaultTimezone = 'America/New_York'; // Default timezone
        
        this.commands = [
            {
                name: 'time',
                description: 'Get current time (default or specific location)',
                usage: '.time [location]',
                aliases: ['clock'],
                permissions: 'public',
                ui: {
                    processingText: '🕐 *Getting Time...*\n\n⏳ Checking world clock...',
                    errorText: '❌ *Time Fetch Failed*'
                },
                execute: this.getCurrentTime.bind(this)
            },
            {
                name: 'timezone',
                description: 'Get timezone information for a location',
                usage: '.timezone <location>',
                aliases: ['tz'],
                permissions: 'public',
                ui: {
                    processingText: '🌍 *Getting Timezone Info...*\n\n⏳ Looking up timezone data...',
                    errorText: '❌ *Timezone Lookup Failed*'
                },
                execute: this.getTimezone.bind(this)
            },
            {
                name: 'worldclock',
                description: 'Show time in major world cities',
                usage: '.worldclock',
                aliases: ['wc'],
                permissions: 'public',
                ui: {
                    processingText: '🌐 *Loading World Clock...*\n\n⏳ Getting global times...',
                    errorText: '❌ *World Clock Failed*'
                },
                execute: this.getWorldClock.bind(this)
            },
            {
                name: 'convert',
                description: 'Convert time between timezones',
                usage: '.convert <time> <from_tz> <to_tz>',
                permissions: 'public',
                ui: {
                    processingText: '🔄 *Converting Time...*\n\n⏳ Calculating timezone difference...',
                    errorText: '❌ *Time Conversion Failed*'
                },
                execute: this.convertTime.bind(this)
            },
            {
                name: 'countdown',
                description: 'Create countdown to specific time',
                usage: '.countdown <date> <time>',
                permissions: 'public',
                ui: {
                    processingText: '⏰ *Creating Countdown...*\n\n⏳ Calculating time difference...',
                    errorText: '❌ *Countdown Creation Failed*'
                },
                execute: this.createCountdown.bind(this)
            }
        ];
    }

    async getCurrentTime(msg, params, context) {
        try {
            if (params.length === 0) {
                // Show default time
                const now = new Date();
                return `🕐 *Current Time*\n\n` +
                       `📅 **Date:** ${now.toLocaleDateString('en-US', { 
                           weekday: 'long', 
                           year: 'numeric', 
                           month: 'long', 
                           day: 'numeric' 
                       })}\n` +
                       `⏰ **Time:** ${now.toLocaleTimeString('en-US', { 
                           hour12: true,
                           hour: '2-digit',
                           minute: '2-digit',
                           second: '2-digit'
                       })}\n` +
                       `🌍 **Timezone:** ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n` +
                       `📊 **UTC Offset:** ${this.getUTCOffset(now)}\n\n` +
                       `💡 Use \`.time <city>\` for specific locations`;
            }

            const location = params.join(' ');
            
            // Get timezone for location using free API
            const response = await axios.get(`http://worldtimeapi.org/api/timezone`);
            const timezones = response.data;
            
            // Find matching timezone
            const matchingTz = timezones.find(tz => 
                tz.toLowerCase().includes(location.toLowerCase()) ||
                tz.split('/')[1]?.toLowerCase().includes(location.toLowerCase())
            );

            if (!matchingTz) {
                return `❌ *Location Not Found*\n\nCouldn't find timezone for "${location}".\n\n💡 Try major cities like: London, Tokyo, Sydney, etc.`;
            }

            const timeResponse = await axios.get(`http://worldtimeapi.org/api/timezone/${matchingTz}`);
            const timeData = timeResponse.data;
            
            const localTime = new Date(timeData.datetime);
            const cityName = matchingTz.split('/')[1]?.replace(/_/g, ' ') || matchingTz;

            return `🕐 *Time in ${cityName}*\n\n` +
                   `📅 **Date:** ${localTime.toLocaleDateString('en-US', { 
                       weekday: 'long', 
                       year: 'numeric', 
                       month: 'long', 
                       day: 'numeric' 
                   })}\n` +
                   `⏰ **Time:** ${localTime.toLocaleTimeString('en-US', { 
                       hour12: true,
                       hour: '2-digit',
                       minute: '2-digit',
                       second: '2-digit'
                   })}\n` +
                   `🌍 **Timezone:** ${timeData.timezone}\n` +
                   `📊 **UTC Offset:** ${timeData.utc_offset}\n` +
                   `🌅 **Day of Year:** ${timeData.day_of_year}\n` +
                   `📆 **Week Number:** ${timeData.week_number}`;

        } catch (error) {
            throw new Error(`Time fetch failed: ${error.message}`);
        }
    }

    async getTimezone(msg, params, context) {
        if (params.length === 0) {
            return '❌ *Timezone Information*\n\nPlease provide a location.\n\n💡 Usage: `.timezone <location>`\n📝 Example: `.timezone London`';
        }

        const location = params.join(' ');

        try {
            const response = await axios.get(`http://worldtimeapi.org/api/timezone`);
            const timezones = response.data;
            
            const matchingTzs = timezones.filter(tz => 
                tz.toLowerCase().includes(location.toLowerCase()) ||
                tz.split('/')[1]?.toLowerCase().includes(location.toLowerCase())
            );

            if (matchingTzs.length === 0) {
                return `❌ *No Timezones Found*\n\nNo timezones found for "${location}".`;
            }

            let tzText = `🌍 *Timezone Information for "${location}"*\n\n`;
            
            for (let i = 0; i < Math.min(matchingTzs.length, 5); i++) {
                const tz = matchingTzs[i];
                try {
                    const timeResponse = await axios.get(`http://worldtimeapi.org/api/timezone/${tz}`);
                    const timeData = timeResponse.data;
                    const localTime = new Date(timeData.datetime);
                    const cityName = tz.split('/')[1]?.replace(/_/g, ' ') || tz;

                    tzText += `${i + 1}. **${cityName}**\n`;
                    tzText += `   🕐 ${localTime.toLocaleTimeString('en-US', { hour12: true })}\n`;
                    tzText += `   📊 UTC${timeData.utc_offset}\n`;
                    tzText += `   🌍 ${tz}\n\n`;
                } catch (err) {
                    continue;
                }
            }

            return tzText;

        } catch (error) {
            throw new Error(`Timezone lookup failed: ${error.message}`);
        }
    }

    async getWorldClock(msg, params, context) {
        const majorCities = [
            'America/New_York',
            'America/Los_Angeles', 
            'Europe/London',
            'Europe/Paris',
            'Asia/Tokyo',
            'Asia/Shanghai',
            'Asia/Dubai',
            'Australia/Sydney',
            'America/Sao_Paulo',
            'Africa/Cairo'
        ];

        try {
            let worldClockText = `🌐 *World Clock*\n\n`;

            for (const timezone of majorCities) {
                try {
                    const response = await axios.get(`http://worldtimeapi.org/api/timezone/${timezone}`);
                    const timeData = response.data;
                    const localTime = new Date(timeData.datetime);
                    const cityName = timezone.split('/')[1]?.replace(/_/g, ' ') || timezone.split('/')[0];
                    
                    const timeString = localTime.toLocaleTimeString('en-US', { 
                        hour12: true,
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    worldClockText += `🏙️ **${cityName}**: ${timeString}\n`;
                    worldClockText += `   📊 UTC${timeData.utc_offset}\n\n`;
                } catch (err) {
                    continue;
                }
            }

            worldClockText += `⏰ Updated: ${new Date().toLocaleTimeString()}`;
            return worldClockText;

        } catch (error) {
            throw new Error(`World clock failed: ${error.message}`);
        }
    }

    async convertTime(msg, params, context) {
        if (params.length < 3) {
            return '❌ *Time Conversion*\n\nPlease provide time and timezones.\n\n💡 Usage: `.convert <time> <from_tz> <to_tz>`\n📝 Example: `.convert 15:30 London Tokyo`';
        }

        const timeStr = params[0];
        const fromLocation = params[1];
        const toLocation = params[2];

        try {
            // Get timezones for both locations
            const response = await axios.get(`http://worldtimeapi.org/api/timezone`);
            const timezones = response.data;
            
            const fromTz = timezones.find(tz => 
                tz.toLowerCase().includes(fromLocation.toLowerCase()) ||
                tz.split('/')[1]?.toLowerCase().includes(fromLocation.toLowerCase())
            );
            
            const toTz = timezones.find(tz => 
                tz.toLowerCase().includes(toLocation.toLowerCase()) ||
                tz.split('/')[1]?.toLowerCase().includes(toLocation.toLowerCase())
            );

            if (!fromTz || !toTz) {
                return `❌ *Timezone Not Found*\n\nCouldn't find timezones for the specified locations.`;
            }

            // Get timezone data
            const [fromResponse, toResponse] = await Promise.all([
                axios.get(`http://worldtimeapi.org/api/timezone/${fromTz}`),
                axios.get(`http://worldtimeapi.org/api/timezone/${toTz}`)
            ]);

            const fromData = fromResponse.data;
            const toData = toResponse.data;

            // Parse time
            const [hours, minutes] = timeStr.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes)) {
                return '❌ *Invalid Time Format*\n\nPlease use HH:MM format (e.g., 15:30)';
            }

            // Calculate offset difference
            const fromOffset = this.parseOffset(fromData.utc_offset);
            const toOffset = this.parseOffset(toData.utc_offset);
            const offsetDiff = toOffset - fromOffset;

            // Convert time
            let convertedHours = hours + offsetDiff;
            let dayChange = '';

            if (convertedHours >= 24) {
                convertedHours -= 24;
                dayChange = ' (+1 day)';
            } else if (convertedHours < 0) {
                convertedHours += 24;
                dayChange = ' (-1 day)';
            }

            const fromCity = fromTz.split('/')[1]?.replace(/_/g, ' ') || fromLocation;
            const toCity = toTz.split('/')[1]?.replace(/_/g, ' ') || toLocation;

            return `🔄 *Time Conversion*\n\n` +
                   `📍 **From:** ${fromCity}\n` +
                   `⏰ **Original:** ${timeStr} (UTC${fromData.utc_offset})\n\n` +
                   `📍 **To:** ${toCity}\n` +
                   `⏰ **Converted:** ${String(convertedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} (UTC${toData.utc_offset})${dayChange}\n\n` +
                   `📊 **Time Difference:** ${Math.abs(offsetDiff)} hours`;

        } catch (error) {
            throw new Error(`Time conversion failed: ${error.message}`);
        }
    }

    async createCountdown(msg, params, context) {
        if (params.length < 2) {
            return '❌ *Countdown Timer*\n\nPlease provide date and time.\n\n💡 Usage: `.countdown <date> <time>`\n📝 Example: `.countdown 2024-12-31 23:59`';
        }

        const dateStr = params[0];
        const timeStr = params[1];

        try {
            const targetDate = new Date(`${dateStr} ${timeStr}`);
            
            if (isNaN(targetDate.getTime())) {
                return '❌ *Invalid Date/Time*\n\nPlease use format: YYYY-MM-DD HH:MM\nExample: 2024-12-31 23:59';
            }

            const now = new Date();
            const timeDiff = targetDate.getTime() - now.getTime();

            if (timeDiff <= 0) {
                return '⏰ *Countdown Complete*\n\nThe specified time has already passed!';
            }

            const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);

            return `⏰ *Countdown Timer*\n\n` +
                   `🎯 **Target:** ${targetDate.toLocaleString()}\n\n` +
                   `⏳ **Time Remaining:**\n` +
                   `📅 ${days} days\n` +
                   `🕐 ${hours} hours\n` +
                   `⏰ ${minutes} minutes\n` +
                   `⏱️ ${seconds} seconds\n\n` +
                   `📊 **Total:** ${Math.floor(timeDiff / 1000)} seconds`;

        } catch (error) {
            throw new Error(`Countdown creation failed: ${error.message}`);
        }
    }

    getUTCOffset(date) {
        const offset = -date.getTimezoneOffset();
        const hours = Math.floor(Math.abs(offset) / 60);
        const minutes = Math.abs(offset) % 60;
        const sign = offset >= 0 ? '+' : '-';
        return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    parseOffset(offsetStr) {
        const match = offsetStr.match(/([+-])(\d{2}):(\d{2})/);
        if (!match) return 0;
        
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2]);
        const minutes = parseInt(match[3]);
        
        return sign * (hours + minutes / 60);
    }


}

module.exports = TimeModule;
