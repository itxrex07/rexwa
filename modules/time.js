const axios = require('axios');

/**
 * TimeModule: Displays the current local time for a specified city, region, or country.
 * Outputs time in 12-hour and 24-hour formats, timezone, and date with day name.
 */
class TimeModule {
  constructor(bot) {
    this.bot = bot;
    this.name = 'time';
    this.metadata = {
      description: 'Displays current local time, timezone, and date for a city, region, or country.',
      version: '1.2.0',
      author: 'HyperWa Team',
      category: 'utility',
    };

    // Fixed default location
    this.defaultLocation = 'New York';

    // Command definitions
    this.commands = [
      {
        name: 'time',
        description: 'Shows the current local time, timezone, and date for a city, region, or country, or the default location (New York).',
        usage: '.time [city/region/country] OR .time',
        aliases: ['t'],
        permissions: 'public',
        ui: {
          processingText: '⏳ Fetching time...',
          errorText: '❌ Failed to fetch time',
        },
        execute: this.timeCommand.bind(this),
      },
    ];
  }

  /**
   * Fetches and displays the current local time, timezone, and date for a specified or default location.
   * @param {object} msg - The message object from Baileys.
   * @param {string[]} params - Command parameters (city, region, or country).
   * @param {object} context - Additional context.
   * @returns {Promise<string>} The formatted time, timezone, and date output.
   */
  async timeCommand(msg, params, context) {
    const location = params.length > 0 ? params.join(' ') : this.defaultLocation;

    try {
      const timeData = await this.getTimeForLocation(location);
      const formattedTime12 = this.formatTime(timeData.datetime, true);
      const formattedTime24 = this.formatTime(timeData.datetime, false);
      const formattedDate = this.formatDate(timeData.datetime);
      return `Time in ${location}:\nTime: ${formattedTime12} | ${formattedTime24}\nTimezone: ${timeData.timezone}\nDate: ${formattedDate}`;
    } catch (error) {
      return `❌ Failed to fetch time for "${location}": ${error.message}`;
    }
  }

  /**
   * Fetches the current time for a given location using the World Time API.
   * @param {string} location - The city, region, or country name.
   * @returns {Promise<object>} Time data including datetime and timezone.
   */
  async getTimeForLocation(location) {
    try {
      // Replace spaces with underscores and encode the location for the API
      const encodedLocation = encodeURIComponent(location.replace(/\s+/g, '_'));
      // Corrected code with https
const response = await axios.get(`https://worldtimeapi.org/api/timezone/${encodedLocation}`);

      if (!response.data.datetime || !response.data.timezone) {
        throw new Error('Invalid response from time API');
      }

      return {
        datetime: response.data.datetime,
        timezone: response.data.timezone,
      };
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Location not found or API error');
    }
  }

  /**
   * Formats a datetime string into 12-hour or 24-hour time format.
   * @param {string} datetime - The ISO datetime string from the API.
   * @param {boolean} is12Hour - Whether to use 12-hour format (true) or 24-hour (false).
   * @returns {string} Formatted time string.
   */
  formatTime(datetime, is12Hour) {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: is12Hour,
    });
  }

  /**
   * Formats a datetime string into a date with day name (e.g., Sunday, August 10, 2025).
   * @param {string} datetime - The ISO datetime string from the API.
   * @returns {string} Formatted date string.
   */
  formatDate(datetime) {
    const date = new Date(datetime);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}

module.exports = TimeModule;
