// index.js

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    REST,
    Routes
} = require('discord.js');

const {
    ChartJSNodeCanvas
} = require('chartjs-node-canvas');

/* =========================================
   CLIENT
========================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* =========================================
   OPENROUTER
========================================= */

const openrouter = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1'
});

/* =========================================
   FILES
========================================= */

const DATA_DIR = path.join(__dirname, 'data');
const CHART_DIR = path.join(DATA_DIR, 'charts');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(CHART_DIR)) {
    fs.mkdirSync(CHART_DIR);
}

if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
}

/* =========================================
   CONFIG
========================================= */

const TOP_LIMIT = 20;

const EDHREC_URL =
    'https://edhrec.com/commanders';

/* =========================================
   COLOR COMMANDS
========================================= */

const colorCommands = [

    { name: 'topw', path: 'w', label: 'White (W)' },
    { name: 'topu', path: 'u', label: 'Blue (U)' },
    { name: 'topb', path: 'b', label: 'Black (B)' },
    { name: 'topr', path: 'r', label: 'Red (R)' },
    { name: 'topg', path: 'g', label: 'Green (G)' },
    { name: 'topc', path: 'colorless', label: 'Colorless (C)' },

    { name: 'topwu', path: 'wu', label: 'Azorius (WU)' },
    { name: 'topub', path: 'ub', label: 'Dimir (UB)' },
    { name: 'topbr', path: 'br', label: 'Rakdos (BR)' },
    { name: 'toprg', path: 'rg', label: 'Gruul (RG)' },
    { name: 'topgw', path: 'gw', label: 'Selesnya (GW)' },
    { name: 'topwb', path: 'wb', label: 'Orzhov (WB)' },
    { name: 'topur', path: 'ur', label: 'Izzet (UR)' },
    { name: 'topbg', path: 'bg', label: 'Golgari (BG)' },
    { name: 'toprw', path: 'rw', label: 'Boros (RW)' },
    { name: 'topgu', path: 'gu', label: 'Simic (GU)' },

    { name: 'topwub', path: 'wub', label: 'Esper (WUB)' },
    { name: 'topubr', path: 'ubr', label: 'Grixis (UBR)' },
    { name: 'topbrg', path: 'brg', label: 'Jund (BRG)' },
    { name: 'toprgw', path: 'rgw', label: 'Naya (RGW)' },
    { name: 'topgwu', path: 'gwu', label: 'Bant (GWU)' },

    { name: 'toprwb', path: 'rwb', label: 'Mardu (RWB)' },
    { name: 'topurg', path: 'urg', label: 'Temur (URG)' },
    { name: 'topwbg', path: 'wbg', label: 'Abzan (WBG)' },
    { name: 'topwur', path: 'wur', label: 'Jeskai (WUR)' },
    { name: 'topubg', path: 'ubg', label: 'Sultai (UBG)' },

    { name: 'topwubr', path: 'wubr', label: 'Yore (WUBR)' },
    { name: 'topubrg', path: 'ubrg', label: 'Glint (UBRG)' },
    { name: 'topwbrg', path: 'wbrg', label: 'Dune (WBRG)' },
    { name: 'topwurg', path: 'wurg', label: 'Ink (WURG)' },
    { name: 'topwubg', path: 'wubg', label: 'Witch (WUBG)' },

    { name: 'topwubrg', path: 'wubrg', label: 'Five Color (WUBRG)' }
];

/* =========================================
   MANA
========================================= */

const COLOR_MAP = {
    W: '⚪',
    U: '🔵',
    B: '⚫',
    R: '🔴',
    G: '🟢'
};

function manaToIcons(manaCost) {

    if (!manaCost) return '';

    const matches = manaCost.match(/\{(.*?)\}/g);

    if (!matches) return '';

    return matches.map(symbol => {

        const clean =
            symbol
                .replace('{', '')
                .replace('}', '');

        if (COLOR_MAP[clean]) {
            return COLOR_MAP[clean];
        }

        if (/^\d+$/.test(clean)) {
            return `〔${clean}〕`;
        }

        if (clean === 'C') {
            return '◇';
        }

        return `(${clean})`;

    }).join('');
}

/* =========================================
   DATE
========================================= */

function getWeekDate() {

    return new Date().toLocaleDateString(
        'es-ES',
        {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }
    );
}

/* =========================================
   SCRYFALL
========================================= */

async function getCommanderData(name) {

    try {

        const response = await axios.get(
            `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`
        );

        const data = response.data;

        return {
            manaCost:
                data.mana_cost ||
                data.card_faces?.[0]?.mana_cost ||
                '',

            image:
                data.image_uris?.normal ||
                data.card_faces?.[0]?.image_uris?.normal ||
                null
        };

    } catch (err) {

        console.error(`Scryfall error (${name}):`, err.message);

        return {
            manaCost: '',
            image: null
        };
    }
}

/* =========================================
   AI CARD SEARCH
========================================= */

async function searchCard(cardName) {

    try {

        const response = await axios.get(
            `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`
        );

        const card = response.data;

        return {
            name: card.name,
            manaCost: card.mana_cost || '',
            type: card.type_line,
            oracle: card.oracle_text || '',
            image: card.image_uris?.normal || null
        };

    } catch {
        return null;
    }
}

/* =========================================
   AI PROMPT
========================================= */

const MTG_SYSTEM_PROMPT = `
You are an expert Magic: The Gathering Commander assistant.

Specialize in:
- EDH
- cEDH
- combos
- stack interactions
- deckbuilding
- synergy
- mulligans
- power level
- mana curve
- politics
- archetypes

Never invent card text.
Always explain interactions clearly.
Use official MTG terminology.
`;

/* =========================================
   ASK AI
========================================= */

async function askAI(question) {

    let cardData = null;

    try {

        const quoted =
            question.match(/"([^"]+)"/);

        if (quoted?.[1]) {
            cardData =
                await searchCard(quoted[1]);
        }

        let context = '';

        if (cardData) {

            context = `
CARD DATA

Name:
${cardData.name}

Mana Cost:
${cardData.manaCost}

Type:
${cardData.type}

Oracle:
${cardData.oracle}
`;
        }

        const completion =
            await openrouter.chat.completions.create({

                model:
                    process.env.AI_MODEL ||
                    'deepseek/deepseek-chat-v3-0324:free',

                messages: [

                    {
                        role: 'system',
                        content: MTG_SYSTEM_PROMPT
                    },

                    {
                        role: 'system',
                        content: context
                    },

                    {
                        role: 'user',
                        content: question
                    }
                ]
            });

        return {
            text:
                completion.choices[0].message.content,
            card: cardData
        };

    } catch (err) {

        console.error(
            'AI ERROR:',
            err.response?.data ||
            err.message
        );

        return null;
    }
}

/* =========================================
   SCRAPER EDHREC
========================================= */

async function getTopCommanders() {

    const browser = await puppeteer.launch({

        headless: true,

        executablePath:
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            undefined,

        args: [

            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-features=site-per-process'
        ]
    });

    try {

        const page = await browser.newPage();

        await page.goto(
            EDHREC_URL,
            {
                waitUntil: 'networkidle2',
                timeout: 0
            }
        );

        await new Promise(resolve =>
            setTimeout(resolve, 5000)
        );

        const data =
            await page.evaluate((TOP_LIMIT) => {

                const cards =
                    document.querySelectorAll(
                        '[class*="Card_container"]'
                    );

                const results = [];

                cards.forEach((card, index) => {

                    if (index >= TOP_LIMIT) return;

                    const name =
                        card.querySelector(
                            '[class*="Card_name"]'
                        )
                        ?.innerText
                        ?.trim();

                    const rankText =
                        card.querySelector(
                            '[class*="CardLabel_rank"]'
                        )
                        ?.innerText
                        ?.trim();

                    const rank =
                        Number(rankText) ||
                        (index + 1);

                    const decksMatch =
                        card.innerText.match(
                            /([\d,.]+)\s*decks/i
                        );

                    const decks =
                        decksMatch
                            ? decksMatch[1]
                            : 'Unknown';

                    if (name) {

                        results.push({
                            rank,
                            name,
                            decks
                        });
                    }
                });

                return results;

            }, TOP_LIMIT);

        for (const commander of data) {

            const scryfall =
                await getCommanderData(
                    commander.name
                );

            commander.manaCost =
                scryfall.manaCost;

            commander.image =
                scryfall.image;
        }

        return data;

    } catch (err) {

        console.error(
            'EDHREC SCRAPER ERROR:',
            err.message
        );

        return [];

    } finally {

        await browser.close();
    }
}

/* =========================================
   COLOR TOPS
========================================= */

async function fetchTopCommanders(
    interaction,
    edhrecPath,
    colorLabel
) {

    try {

        await interaction.deferReply({
            ephemeral: true
        });

        const url =
            `https://edhrec.com/commanders/${edhrecPath}`;

        const response =
            await axios.get(url);

        const $ =
            cheerio.load(response.data);

        const nextData =
            $('#__NEXT_DATA__').html();

        if (!nextData) {

            return interaction.editReply({
                content:
                    '❌ No se pudieron obtener datos de EDHREC.'
            });
        }

        const json =
            JSON.parse(nextData);

        let commanders =
            json.props.pageProps.data
                .container.json_dict.cardlists[0]
                .cardviews;

        commanders =
            commanders.slice(0, 50);

        const embeds = [];

        for (let i = 0; i < commanders.length; i += 10) {

            const chunk =
                commanders.slice(i, i + 10);

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `🔥 Top 50 ${colorLabel}`
                    )
                    .setColor(0x8b5cf6)
                    .setFooter({
                        text:
                            `Página ${Math.floor(i / 10) + 1}/5`
                    });

            for (let j = 0; j < chunk.length; j++) {

                const c = chunk[j];

                const scryfall =
                    await getCommanderData(
                        c.name
                    );

                const manaIcons =
                    manaToIcons(
                        scryfall.manaCost
                    );

                embed.addFields({
                    name:
                        `#${i + j + 1} ${manaIcons} ${c.name}`,
                    value:
                        `📚 ${c.num_decks || 'Unknown'} decks`,
                    inline: false
                });

                if (j === 0 && scryfall.image) {
                    embed.setThumbnail(
                        scryfall.image
                    );
                }
            }

            embeds.push(embed);
        }

        let currentPage = 0;

        const row =
            new ActionRowBuilder()
                .addComponents(

                    new ButtonBuilder()
                        .setCustomId('prev')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Secondary),

                    new ButtonBuilder()
                        .setCustomId('next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                );

        const message =
            await interaction.editReply({

                embeds: [embeds[currentPage]],
                components: [row]
            });

        const collector =
            message.createMessageComponentCollector({

                time: 300000,

                filter: i =>
                    i.user.id ===
                    interaction.user.id
            });

        collector.on('collect', async i => {

            if (i.customId === 'prev') {

                currentPage--;

                if (currentPage < 0) {
                    currentPage =
                        embeds.length - 1;
                }
            }

            if (i.customId === 'next') {

                currentPage++;

                if (
                    currentPage >=
                    embeds.length
                ) {
                    currentPage = 0;
                }
            }

            await i.update({
                embeds: [embeds[currentPage]],
                components: [row]
            });
        });

    } catch (err) {

        console.error(err);

        if (interaction.deferred || interaction.replied) {

            await interaction.editReply({
                content:
                    '❌ Error obteniendo commanders.'
            });
        }
    }
}

/* =========================================
   HISTORY
========================================= */

function loadHistory() {

    try {

        return JSON.parse(
            fs.readFileSync(HISTORY_FILE)
        );

    } catch {

        return [];
    }
}

function saveHistory(history) {

    fs.writeFileSync(
        HISTORY_FILE,
        JSON.stringify(
            history,
            null,
            2
        )
    );
}

/* =========================================
   CHART
========================================= */

async function createChart(history) {

    const chartJSNodeCanvas =
        new ChartJSNodeCanvas({

            width: 1200,
            height: 500,
            backgroundColour: '#1e1e2f'
        });

    const latest =
        history.slice(-5);

    const commanders = {};

    latest.forEach(week => {

        week.commanders.forEach(c => {

            if (!commanders[c.name]) {
                commanders[c.name] = [];
            }

            commanders[c.name]
                .push(c.rank);
        });
    });

    const datasets =
        Object.entries(commanders)
            .slice(0, 5)
            .map(([name, ranks]) => ({
                label: name,
                data: ranks,
                fill: false
            }));

    const image =
        await chartJSNodeCanvas.renderToBuffer({

            type: 'line',

            data: {
                labels:
                    latest.map(
                        (_, i) =>
                            `Semana ${i + 1}`
                    ),

                datasets
            },

            options: {
                responsive: false,
                plugins: {
                    legend: {
                        labels: {
                            color: 'white'
                        }
                    }
                },
                scales: {
                    y: {
                        reverse: true,
                        ticks: {
                            color: 'white'
                        }
                    },
                    x: {
                        ticks: {
                            color: 'white'
                        }
                    }
                }
            }
        });

    const chartPath =
        path.join(
            CHART_DIR,
            'ranking.png'
        );

    fs.writeFileSync(chartPath, image);

    return chartPath;
}

/* =========================================
   SEND WEEKLY TOP
========================================= */

async function sendTop(channel) {

    try {

        const commanders =
            await getTopCommanders();

        if (!commanders.length) {
            return;
        }

        const history =
            loadHistory();

        history.push({
            date:
                new Date()
                    .toISOString(),
            commanders
        });

        saveHistory(history);

        const chartPath =
            await createChart(history);

        const attachment =
            new AttachmentBuilder(
                chartPath,
                {
                    name: 'ranking.png'
                }
            );

        const mainEmbed =
            new EmbedBuilder()
                .setTitle(
                    `🔥 Top ${TOP_LIMIT} Commanders - ${getWeekDate()}`
                )
                .setDescription(
                    `🔗 ${EDHREC_URL}`
                )
                .setImage(
                    'attachment://ranking.png'
                )
                .setColor(0x8b5cf6);

        await channel.send({
            embeds: [mainEmbed],
            files: [attachment]
        });

        for (const c of commanders) {

            const manaIcons =
                manaToIcons(
                    c.manaCost
                );

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `#${c.rank} ${manaIcons} ${c.name}`
                    )
                    .setDescription(
                        `📚 ${c.decks} decks`
                    )
                    .setColor(0x8b5cf6);

            if (c.image) {
                embed.setImage(c.image);
            }

            await channel.send({
                embeds: [embed]
            });
        }

        await channel.send({
            content:
                `🔗 Ver ranking completo:\n${EDHREC_URL}`
        });

    } catch (err) {

        console.error(
            'ERROR EN sendTop:',
            err
        );
    }
}

/* =========================================
   REGISTER COMMANDS
========================================= */

async function registerCommands() {

    const commands = [

        new SlashCommandBuilder()
            .setName('topcommanders')
            .setDescription(
                'Top 20 commanders'
            ),

        new SlashCommandBuilder()
            .setName('ask')
            .setDescription(
                'Ask the MTG AI'
            )
            .addStringOption(option =>
                option
                    .setName('question')
                    .setDescription(
                        'Your MTG question'
                    )
                    .setRequired(true)
            )
    ];

    colorCommands.forEach(c => {

        commands.push(

            new SlashCommandBuilder()
                .setName(c.name)
                .setDescription(
                    `Top 50 ${c.label} commanders`
                )
        );
    });

    const rest =
        new REST({
            version: '10'
        }).setToken(
            process.env.TOKEN
        );

    await rest.put(

        Routes.applicationCommands(
            process.env.CLIENT_ID
        ),

        {
            body:
                commands.map(
                    c => c.toJSON()
                )
        }
    );

    console.log(
        '✅ Slash commands registrados'
    );
}

/* =========================================
   READY
========================================= */

client.once(
    'ready',
    async () => {

        console.log(
            `✅ Conectado como ${client.user.tag}`
        );

        await registerCommands();

        let channel;

        try {

            channel =
                await client.channels.fetch(
                    process.env.CHANNEL
                );

        } catch (err) {

            console.error(
                'Error fetching channel:',
                err.message
            );

            return;
        }

        if (!channel) return;

        await sendTop(channel);

        cron.schedule(
            '0 12 * * 1',
            async () => {

                console.log(
                    '⏰ Enviando top semanal...'
                );

                await sendTop(channel);
            }
        );
    }
);

/* =========================================
   INTERACTIONS
========================================= */

client.on(
    'interactionCreate',
    async interaction => {

        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        const commandName =
            interaction.commandName;

        /* =========================================
           /ASK
        ========================================= */

        if (commandName === 'ask') {

            await interaction.deferReply({
                ephemeral: true
            });

            const question =
                interaction.options.getString(
                    'question'
                );

            const ai =
                await askAI(question);

            if (!ai) {

                return interaction.editReply({
                    content:
                        '❌ Error contacting AI.'
                });
            }

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        '🧠 MTG Commander AI'
                    )
                    .setDescription(
                        ai.text.slice(0, 4000)
                    )
                    .setColor(0x8b5cf6);

            if (ai.card?.image) {
                embed.setThumbnail(
                    ai.card.image
                );
            }

            return interaction.editReply({
                embeds: [embed]
            });
        }

        /* =========================================
           TOP 20
        ========================================= */

        if (
            commandName ===
            'topcommanders'
        ) {

            await interaction.deferReply({
                ephemeral: true
            });

            const commanders =
                await getTopCommanders();

            if (!commanders.length) {

                return interaction.editReply({
                    content:
                        '❌ No se pudieron obtener commanders.'
                });
            }

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `🔥 Top ${TOP_LIMIT} Commanders`
                    )
                    .setColor(0x8b5cf6);

            commanders.forEach(c => {

                const manaIcons =
                    manaToIcons(
                        c.manaCost
                    );

                embed.addFields({
                    name:
                        `#${c.rank} ${manaIcons} ${c.name}`,
                    value:
                        `📚 ${c.decks} decks`,
                    inline: false
                });
            });

            return interaction.editReply({
                embeds: [embed]
            });
        }

        /* =========================================
           COLOR COMMANDS
        ========================================= */

        const colorCmd =
            colorCommands.find(
                c =>
                    c.name ===
                    commandName
            );

        if (colorCmd) {

            return fetchTopCommanders(
                interaction,
                colorCmd.path,
                colorCmd.label
            );
        }
    }
);

/* =========================================
   LOGIN
========================================= */

client.login(
    process.env.TOKEN
);