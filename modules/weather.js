const axios = require('axios');

class WeatherModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'weather';
        this.metadata = {
            description: 'Get weather information for any location',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'information',
            dependencies: ['axios']
        };
        this.commands = [
            {
                name: 'weather',
                description: 'Get current weather for a location',
                usage: '.weather <location>',
                permissions: 'public',
                ui: {
                    processingText: '🌤️ *Fetching Weather Data...*\n\n⏳ Getting current conditions...',
                    errorText: '❌ *Weather Fetch Failed*'
                },
                execute: this.getCurrentWeather.bind(this)
            },
            {
                name: 'forecast',
                description: 'Get 5-day weather forecast',
                usage: '.forecast <location>',
                permissions: 'public',
                ui: {
                    processingText: '📅 *Fetching Weather Forecast...*\n\n⏳ Getting 5-day forecast...',
                    errorText: '❌ *Forecast Fetch Failed*'
                },
                execute: this.getWeatherForecast.bind(this)
            },
            {
                name: 'alerts',
                description: 'Get weather alerts for a location',
                usage: '.alerts <location>',
                permissions: 'public',
                ui: {
                    processingText: '⚠️ *Checking Weather Alerts...*\n\n⏳ Scanning for warnings...',
                    errorText: '❌ *Alert Check Failed*'
                },
                execute: this.getWeatherAlerts.bind(this)
            }
        ];
        // Using free weather APIs without authentication
        this.defaultCity = 'New York'; // Default city for .weather command
    }

    async getCurrentWeather(msg, params, context) {
        const location = params.length > 0 ? params.join(' ') : this.defaultCity;

        try {
            // Using wttr.in - free weather service
            const response = await axios.get(`https://wttr.in/${encodeURIComponent(location)}`, {
                params: { format: 'j1' },
                headers: {
                    'User-Agent': 'curl/7.68.0'
                }
            });

            const data = response.data;
            const current = data.current_condition[0];
            const area = data.nearest_area[0];
            
            const temp = current.temp_C;
            const feelsLike = current.FeelsLikeC;
            const humidity = current.humidity;
            const pressure = current.pressure;
            const windSpeed = current.windspeedKmph;
            const windDir = current.winddir16Point;
            const visibility = current.visibility;
            const description = current.weatherDesc[0].value;
            const icon = this.getWeatherEmoji(current.weatherCode);

            return `🌤️ *Weather in ${area.areaName[0].value}, ${area.country[0].value}*\n\n` +
                   `${icon} ${description}\n` +
                   `🌡️ Temperature: ${temp}°C (feels like ${feelsLike}°C)\n` +
                   `💧 Humidity: ${humidity}%\n` +
                   `🌪️ Wind: ${windSpeed} km/h ${windDir}\n` +
                   `📊 Pressure: ${pressure} mb\n` +
                   `👁️ Visibility: ${visibility} km\n` +
                   `🌡️ UV Index: ${current.uvIndex}\n\n` +
                   `⏰ ${new Date().toLocaleString()}`;

        } catch (error) {
            if (error.response?.status === 404 || error.message.includes('Unknown location')) {
                return `❌ *Location Not Found*\n\nCouldn't find weather data for "${location}".\nPlease check the spelling and try again.`;
            }
            throw new Error(`Weather fetch failed: ${error.message}`);
        }
    }

    async getWeatherForecast(msg, params, context) {
        const location = params.length > 0 ? params.join(' ') : this.defaultCity;

        try {
            const response = await axios.get(`https://wttr.in/${encodeURIComponent(location)}`, {
                params: { format: 'j1' },
                headers: {
                    'User-Agent': 'curl/7.68.0'
                }
            });

            const data = response.data;
            const area = data.nearest_area[0];
            const weather = data.weather;
            
            let forecastText = `📅 *5-Day Forecast for ${area.areaName[0].value}, ${area.country[0].value}*\n\n`;
            
            weather.slice(0, 5).forEach((day, index) => {
                const date = new Date(day.date);
                const dayName = index === 0 ? 'Today' : date.toLocaleDateString('en', { weekday: 'long' });
                
                const maxTemp = day.maxtempC;
                const minTemp = day.mintempC;
                const description = day.hourly[4].weatherDesc[0].value; // Midday weather
                const icon = this.getWeatherEmoji(day.hourly[4].weatherCode);
                const humidity = day.hourly[4].humidity;
                const windSpeed = day.hourly[4].windspeedKmph;
                const chanceOfRain = day.hourly[4].chanceofrain;
                
                forecastText += `${icon} **${dayName}** (${date.toLocaleDateString()})\n`;
                forecastText += `   🌡️ ${maxTemp}°C / ${minTemp}°C • ${description}\n`;
                forecastText += `   💧 ${humidity}% • 🌪️ ${windSpeed} km/h • 🌧️ ${chanceOfRain}%\n\n`;
            });

            return forecastText;

        } catch (error) {
            if (error.response?.status === 404 || error.message.includes('Unknown location')) {
                return `❌ *Location Not Found*\n\nCouldn't find weather data for "${location}".\nPlease check the spelling and try again.`;
            }
            throw new Error(`Forecast fetch failed: ${error.message}`);
        }
    }

    async getWeatherAlerts(msg, params, context) {
        const location = params.length > 0 ? params.join(' ') : this.defaultCity;

        try {
            // Get weather alerts from wttr.in
            const response = await axios.get(`https://wttr.in/${encodeURIComponent(location)}`, {
                params: { format: 'j1' },
                headers: {
                    'User-Agent': 'curl/7.68.0'
                }
            });

            const data = response.data;
            const area = data.nearest_area[0];
            const current = data.current_condition[0];
            
            // Check for severe weather conditions
            const alerts = [];
            const weatherCode = parseInt(current.weatherCode);
            
            if (weatherCode >= 200 && weatherCode < 300) {
                alerts.push({
                    event: 'Thunderstorm Warning',
                    description: 'Thunderstorm conditions detected in the area.',
                    severity: 'Moderate'
                });
            }
            
            if (weatherCode >= 300 && weatherCode < 400) {
                alerts.push({
                    event: 'Light Rain Advisory',
                    description: 'Light rain or drizzle expected.',
                    severity: 'Minor'
                });
            }
            
            if (weatherCode >= 500 && weatherCode < 600) {
                alerts.push({
                    event: 'Rain Warning',
                    description: 'Heavy rain conditions expected.',
                    severity: 'Moderate'
                });
            }
            
            if (weatherCode >= 600 && weatherCode < 700) {
                alerts.push({
                    event: 'Snow Warning',
                    description: 'Snow conditions detected.',
                    severity: 'Moderate'
                });
            }
            
            if (parseInt(current.windspeedKmph) > 50) {
                alerts.push({
                    event: 'High Wind Advisory',
                    description: `Strong winds detected: ${current.windspeedKmph} km/h`,
                    severity: 'Moderate'
                });
            }

            if (alerts.length === 0) {
                return `✅ *No Weather Alerts*\n\nNo active weather alerts for ${area.areaName[0].value}, ${area.country[0].value}.\n\n⏰ ${new Date().toLocaleString()}`;
            }

            let alertText = `⚠️ *Weather Alerts for ${area.areaName[0].value}*\n\n`;

            alerts.forEach((alert, index) => {
                const severityEmoji = alert.severity === 'Severe' ? '🔴' : 
                                    alert.severity === 'Moderate' ? '🟡' : '🟢';
                                    
                alertText += `${severityEmoji} **${alert.event}**\n`;
                alertText += `📝 ${alert.description}\n`;
                alertText += `⚠️ Severity: ${alert.severity}\n\n`;
            });

            return alertText;

        } catch (error) {
            if (error.response?.status === 404 || error.message.includes('Unknown location')) {
                return `❌ *Location Not Found*\n\nCouldn't find weather data for "${location}".\nPlease check the spelling and try again.`;
            }
            throw new Error(`Weather alerts fetch failed: ${error.message}`);
        }
    }

    getWeatherEmoji(weatherCode) {
        const code = parseInt(weatherCode);
        const iconMap = {
            113: '☀️', 116: '⛅', 119: '☁️', 122: '☁️', 143: '🌫️',
            176: '🌦️', 179: '🌨️', 182: '🌧️', 185: '🌧️', 200: '⛈️',
            227: '❄️', 230: '❄️', 248: '🌫️', 260: '🌫️', 263: '🌦️',
            266: '🌦️', 281: '🌧️', 284: '🌧️', 293: '🌦️', 296: '🌦️',
            299: '🌧️', 302: '🌧️', 305: '🌧️', 308: '🌧️', 311: '🌧️',
            314: '🌧️', 317: '🌧️', 320: '🌨️', 323: '❄️', 326: '❄️',
            329: '❄️', 332: '❄️', 335: '❄️', 338: '❄️', 350: '🌧️',
            353: '🌦️', 356: '🌧️', 359: '🌧️', 362: '🌨️', 365: '🌨️',
            368: '🌨️', 371: '❄️', 374: '🌧️', 377: '🌧️', 386: '⛈️',
            389: '⛈️', 392: '⛈️', 395: '❄️'
        };
        return iconMap[code] || '🌤️';
    }

    async init() {
        console.log('✅ Weather module initialized (no API required)');
    }

    async destroy() {
        console.log('🛑 Weather module destroyed');
    }
}

module.exports = WeatherModule;
