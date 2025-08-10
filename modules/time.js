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
/**
 * Fetches the current time for a given location using the World Time API.
 * This version searches for a matching timezone from the API's list.
 * @param {string} location - The city, region, or country name provided by the user.
 * @returns {Promise<object>} Time data including datetime and timezone.
 */
async getTimeForLocation(location) {
  try {
    // 1. Fetch the list of all valid timezones from the API.
    const allTimezonesResponse = await axios.get('https://worldtimeapi.org/api/timezone');
    const allTimezones = allTimezonesResponse.data;

    // 2. Prepare the user's input for searching (case-insensitive, uses underscore).
    const searchQuery = location.replace(/\s+/g, '_').toLowerCase();

    // 3. Find the first timezone that includes the user's search query.
    // e.g., input "sydney" will match "Australia/Sydney".
    const foundTimezone = allTimezones.find(tz => tz.toLowerCase().includes(searchQuery));

    // 4. If no matching timezone is found, throw a clear error.
    if (!foundTimezone) {
      throw new Error('Location not found.');
    }

    // 5. A valid timezone was found, now fetch the time for it.
    // The foundTimezone is already in the correct `Area/Location` format.
    const response = await axios.get(`https://worldtimeapi.org/api/timezone/${foundTimezone}`);

    if (!response.data.datetime || !response.data.timezone) {
      throw new Error('Invalid response from time API');
    }

    return {
      datetime: response.data.datetime,
      timezone: response.data.timezone,
    };
  } catch (error) {
    // Pass along a cleaner error message.
    // If the API returned a specific error (like `error.response.data.error`), use it.
    // Otherwise, use the error message we created (e.g., "Location not found.").
    throw new Error(error.response?.data?.error || error.message || 'API error');
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
