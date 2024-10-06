/*
    * discord_bot.js
    * Discord bot that plays music in a voice channel.
    * 
    Help: https://www.npmjs.com/package/discord-player-youtubei
    Help: https://www.npmjs.com/package/discord-player
    Help: https://github.com/Androz2091/discord-player/tree/434d1f2d833ba1812ceb16d7481d473460c18850
*/

const { Client, GatewayIntentBits, GuildMember, Intents, Guild } = require('discord.js');
const { Player, QueryType, useMainPlayer, useQueue, entersState, GuildQueuePlayerNode, usePlayer } = require('discord-player');
const SpotifyWebApi = require('spotify-web-api-node');
const { YoutubeiExtractor } = require("discord-player-youtubei")

class AudioBot {

    constructor(DISCORD_BOT_TOKEN, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY) {
        this.token = DISCORD_BOT_TOKEN;
        this.spotifyApi = new SpotifyWebApi({
            clientId: SPOTIFY_CLIENT_ID,
            clientSecret: SPOTIFY_CLIENT_SECRET,
        });
        this.youtubeApiKey = YOUTUBE_API_KEY;

        // Create a new Discord client, with only the necessary intents enabled
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages,
            ],
        });

        // Login and handle any potential errors
        this.client.login(this.token).catch((error) => {
            console.error('Failed to login to Discord:', error);
        });

        this.player = new Player(this.client);
        this.player.extractors.register(YoutubeiExtractor, {});

        this.queue = new Map(); // Map of queues for each guild

        this.isPlaying = false;
        this.audioStreams = new Map(); // Map of audio streams for each user
        this.currentConnection = null;

        this.player.on('error', (queue, error) => {
            console.error(`Player error: ${error.message}`);
            queue.metadata.channel.send(`An error occurred: ${error.message}`);
        });

        this.player.on('playerError', (queue, error) => {
            console.error(`Player error: ${error.message}`);
            queue.metadata.channel.send(`A player error occurred: ${error.message}`);
        });

        console.log('Bot initialized and ready to handle commands.');

        this.voiceChannel = null;
    }

    async playCommand(interaction) {

        this.isPlaying = true;

        // Ensure we defer the interaction as soon as possible if it's not already deferred
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        // check if the bot is already in the voice channel
        if (!this.voiceChannel) {
            console.log('No voice channel found in the bot instance.');
            this.voiceChannel = interaction.member.voice.channel;

            if (!this.voiceChannel) {
                await interaction.followUp('You need to join a voice channel first!');
                return;
            }
        }

        try {
            // If connected to a different channel, disconnect
            if (this.currentConnection && this.currentConnection.joinConfig.channelId !== this.voiceChannel.id) {
                this.currentConnection.destroy();
                this.currentConnection = null;
            }

            // Ensure connection to the voice channel
            if (!this.currentConnection) {
            }

            const query = interaction.options.getString('song_url', true);

            // Stop recording if active
            if (this.isRecording) {
                await this.stopRecording();
            }

            // Proceed with playing the song, ensuring this is done only once
            console.log("Playing the song");
            const { track } =
                await
                    this.player.play(
                        this.voiceChannel,
                        query,
                        {
                            nodeOptions:
                                { metadata: interaction }
                        }
                    );

            // Listen for when the track finishes to reset `isPlaying`
            this.player.on('end', () => {
                console.log('Song finished playing.');
                this.isPlaying = false;

                // Optionally disconnect the bot after the song ends
                if (this.currentConnection) {
                    this.currentConnection.destroy();
                    this.currentConnection = null;
                    console.log('Disconnected from voice channel');
                }
            });

            // Respond to the interaction after processing
            await interaction.followUp(`**${track.cleanTitle}** enqueued!`);

        } catch (e) {
            console.error(`Error playing music: ${e.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.followUp(`Something went wrong: ${e.message}`);
            }
        }

    }

    async skipCommand(interaction) {
        try {
            const queue = useQueue(interaction.guild.id);
            const client = interaction.client;
            const errorMessage = client?.dev?.error || '⚠️ Error';  // Fallback error message

            if (!queue) return interaction.reply({ content: `${errorMessage} | I am **not** in a voice channel`, ephemeral: true });
            if (!queue.currentTrack)
                return interaction.reply({ content: `${errorMessage} | There is no track **currently** playing`, ephemeral: true });

            // check if there is a next track
            if (!queue.tracks.length) {
                this.isPlaying = false;
                queue.node.stop();

                return interaction.reply({
                    content: `⏹ | There are no more tracks to play, stopping the music`
                });

            }
            else {
                queue.node.skip();
            }
        }
        catch (e) {
            console.log("Error: ", e);
        }

        return interaction.reply({
            content: `⏩ | I have skipped to the next track`
        });
    }

    async stopCommand(interaction) {

        try {
            const queue = useQueue(interaction.guild.id);
            const client = interaction.client;  // Use client directly from interaction
            const errorMessage = client?.dev?.error || '⚠️ Error';  // Fallback error message

            // Check if there's a queue and if it's currently playing a track
            if (!queue) {
                return interaction.reply({
                    content: `${errorMessage} | I am **not** in a voice channel`,
                    ephemeral: true
                });
            }

            if (!queue.currentTrack) {
                return interaction.reply({
                    content: `${errorMessage} | There is no track **currently** playing`,
                    ephemeral: true
                });
            }

            // Clear the queue and stop the current track
            queue.tracks.clear();
            queue.node.stop();

            // Check if there is an active connection before trying to destroy it
            if (this.currentConnection) {
                this.currentConnection.destroy();
                this.currentConnection = null;
                console.log("Disconnected from the voice channel.");
            } else {
                console.log("No active connection to destroy.");
            }

            this.isPlaying = false;
        } catch (e) {
            console.log("Error: ", e);
        }

        // Respond to the interaction that the music has stopped
        return interaction.reply({
            content: `⏹ | I have stopped the music`
        });
    }

    async syncCommands() {
        const guild = this.client.guilds.cache.first();
        if (!guild) {
            console.error('No guild found!');
            return;
        }

        /*
        Type: 
        1 - SUB_COMMAND, 2 - SUB_COMMAND_GROUP, 
        3 - STRING, 4 - INTEGER, 5 - BOOLEAN, 
        6 - USER, 7 - CHANNEL, 8 - ROLE
        9 - MENTIONABLE, 10 - NUMBER, 11: - Decimals
        */

        // Define your commands
        const commands = [
            {
                name: 'play',
                description: 'Play a song',
                options: [
                    {
                        name: 'song_url',
                        description: 'Name of the song to play',
                        type: 3,
                        required: true,
                    },
                ],
            },
            {
                name: 'skip',
                description: 'Skip the current song',
            },
            {
                name: 'stop',
                description: 'Stop the music',
            }
        ];

        try {
            console.log('Clearing commands...');

            const existingCommands = await guild.commands.fetch();
            if (existingCommands.size > 3) {
                await guild.commands.set([]); // Clear existing commands
                console.log('Commands cleared!');
            } else {
                console.log('Less than 3 commands, no need to clear.');
            }

            console.log('Attempting to register commands...');
            for (const command of commands) {
                const createdCommand = await guild.commands.create(command);
                console.log(`Registered command: ${createdCommand.name} with ID: ${createdCommand.id}`);
            }
        } catch (error) {
            console.error('Failed to sync commands:', error);
        }
    }

    async setupCommands() {
        // Command map with corresponding handler functions
        const commandHandlers = {
            play: this.playCommand.bind(this),
            skip: this.skipCommand.bind(this),
            stop: this.stopCommand.bind(this)
        };

        // Listen for interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;

            const command = interaction.commandName;
            if (commandHandlers[command]) {
                try {
                    await commandHandlers[command](interaction);
                } catch (error) {
                    console.error(`Error executing command ${command}: ${error.message}`);
                    await interaction.reply('There was an error executing that command.');
                }
            } else {
                await interaction.reply('Unknown command.');
            }
        });
    }

    async run() {
        // Wait for the client to be ready before proceeding
        this.client.once('ready', async () => {
            console.log('Bot is ready!');

            // Synchronize commands once the bot is ready
            await this.syncCommands();
            console.log('Commands synchronized!');
        });

        // Setup command handlers
        this.setupCommands();

        // Log in the bot
        await this.client.login(this.token);
    }
}

module.exports = { AudioBot };
