/* 
    * env_config.js
    * Loads environment variables from a .env file.
    * Returns an object with the environment variables.
*/

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function loadEnvVariables() {
    return {
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
        SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
        YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    };
}

module.exports = { loadEnvVariables };
