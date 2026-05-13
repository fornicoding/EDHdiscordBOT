// index.js

require('dotenv').config();

const fs = require('fs');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    AttachmentBuilder,
    PermissionsBitField,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const {
    ChartJSNodeCanvas
} = require('chartjs-node-canvas');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const HISTORY_FILE = './data/history.json';

if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
}

if (!fs.existsSync('./data/charts')) {
    fs.mkdirSync('./data/charts');
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
   ── NEW FEATURE: Top commanders by color ──
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
   COLORES MANA
========================================= */

const COLOR_MAP = {
    W: '⚪',
    U: '🔵',
    B: '⚫',
    R: '🔴',
    G: '🟢'
};

function manaToIcons(manaCost) {

    if (!manaCost) {
        return '';
    }

    const matches =
        manaCost.match(/\{(.*?)\}/g);

    if (!matches) {
        return '';
    }

    return matches
        .map(symbol => {

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

        })
        .join('');
}

/* =========================================
   FECHA
========================================= */

function getWeekDate() {

    const now = new Date();

    return now.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/* =========================================
   SCRYFALL
========================================= */

async function getCommanderData(name) {

    try {

        const response = await fetch(
            `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`
        );

        const data = await response.json();

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

    } catch {

        return {
            manaCost: '',
            image: null
        };
    }
}

/* =========================================
   SCRAPER EDHREC
========================================= */

async function getTopCommanders() {

    const browser =
        await puppeteer.launch({

            headless: true,

            executablePath:
                process.env.PUPPETEER_EXECUTABLE_PATH ||
                undefined,

            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

    try {

        const page =
            await browser.newPage();

        await page.goto(
            EDHREC_URL,
            {
                waitUntil: 'domcontentloaded',
                timeout: 0
            }
        );

        await new Promise(resolve =>
            setTimeout(resolve, 6000)
        );

        const data =
            await page.evaluate((TOP_LIMIT) => {

                const cards =
                    document.querySelectorAll(
                        '[class*="Card_container"]'
                    );

                const results = [];

                cards.forEach(
                    (card, index) => {

                        if (index < TOP_LIMIT) {

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
                        }
                    }
                );

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

    } finally {

        await browser.close();
    }
}

/* =========================================
   ── NEW FEATURE: Top commanders by color ──
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

        await interaction.editReply(
            '⏳ Fetching top 50 commanders...'
        );

        const url =
            `https://edhrec.com/commanders/${edhrecPath}`;

        const response =
            await axios.get(url);

        const $ =
            cheerio.load(response.data);

        const nextData =
            $('#__NEXT_DATA__').html();

        const json =
            JSON.parse(nextData);

        let commanders =
            json.props.pageProps.data
                .container.json_dict.cardlists[0]
                .cardviews;

        commanders =
            commanders.slice(0, 50);

        const enriched = [];

        for (let i = 0; i < commanders.length; i++) {

            const c = commanders[i];

            const scryfall =
                await getCommanderData(c.name);

            enriched.push({

                rank: i + 1,

                name: c.name,

                decks:
                    c.num_decks ||
                    'Unknown',

                manaCost:
                    scryfall.manaCost,

                image:
                    scryfall.image
            });
        }

        const pages = [];

        for (let i = 0; i < enriched.length; i += 10) {

            const chunk =
                enriched.slice(i, i + 10);

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

            chunk.forEach(c => {

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

            const firstImage =
                chunk.find(c => c.image);

            if (firstImage?.image) {

                embed.setThumbnail(
                    firstImage.image
                );
            }

            pages.push(embed);
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

                content: '',

                embeds: [
                    pages[currentPage]
                ],

                components: [row]
            });

        const collector =
            message.createMessageComponentCollector({

                time: 300000,

                filter: i =>
                    i.user.id ===
                    interaction.user.id
            });

        collector.on(
            'collect',
            async i => {

                await new Promise(resolve =>
                    setTimeout(resolve, 1500)
                );

                if (
                    i.customId === 'prev'
                ) {

                    currentPage--;

                    if (currentPage < 0) {
                        currentPage =
                            pages.length - 1;
                    }
                }

                if (
                    i.customId === 'next'
                ) {

                    currentPage++;

                    if (
                        currentPage >=
                        pages.length
                    ) {
                        currentPage = 0;
                    }
                }

                await i.update({

                    embeds: [
                        pages[currentPage]
                    ],

                    components: [row]
                });
            }
        );
    } catch (err) {

        console.error(err);

        await interaction.editReply({
            content:
                '❌ Error obteniendo commanders.'
        });
    }
}

/* =========================================
   HISTORIAL
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
        JSON.stringify(history, null, 2)
    );
}

/* =========================================
   CHART
========================================= */

async function createChart(history) {

    const width = 1200;
    const height = 500;

    const chartJSNodeCanvas =
        new ChartJSNodeCanvas({
            width,
            height,
            backgroundColour: '#1e1e2f'
        });

    const latest =
        history.slice(-5);

    const commanders = {};

    latest.forEach(week => {

        week.commanders.forEach(c => {

            if (
                !commanders[c.name]
            ) {
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

    const configuration = {

        type: 'line',

        data: {

            labels:
                latest.map(
                    (_, i) =>
                        `Semana ${i + 1}`
                ),

            datasets
        }
    };

    const image =
        await chartJSNodeCanvas
            .renderToBuffer(
                configuration
            );

    const path =
        './data/charts/ranking.png';

    fs.writeFileSync(path, image);

    return path;
}

/* =========================================
   BLOQUEAR CHAT
========================================= */

async function lockChannel(channel) {

    try {

        const me = channel.guild.members.me;

        if (
            !me.permissions.has(
                PermissionsBitField.Flags.ManageChannels
            )
        ) {
            return;
        }

        await channel.permissionOverwrites.edit(
            channel.guild.roles.everyone,
            {
                SendMessages: false
            }
        );

    } catch {}
}

/* =========================================
   ENVIAR TOP SEMANAL
========================================= */

async function sendTop(channel) {

    try {

        const commanders =
            await getTopCommanders();

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
            await createChart(
                history
            );

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
                    `🔥 Top ${TOP_LIMIT} Commanders`
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

                    .setColor(
                        0x8b5cf6
                    );

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
   READY
========================================= */

client.once(
    'clientReady',
    async () => {

        console.log(
            `Conectado como ${client.user.tag}`
        );

        let channel;

        try {

            channel =
                await client.channels.fetch(
                    process.env.CHANNEL
                );

        } catch {

            return;
        }

        if (!channel) {
            return;
        }

        await lockChannel(channel);

        await sendTop(channel);

        cron.schedule(
            '0 12 * * 1',
            async () => {

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
           TOP ORIGINAL
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

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        `🔥 Top ${TOP_LIMIT} Commanders`
                    )

                    .setDescription(
                        commanders
                            .map(c => {

                                const manaIcons =
                                    manaToIcons(
                                        c.manaCost
                                    );

                                return `#${c.rank} ${manaIcons} ${c.name} — 📚 ${c.decks} decks`;
                            })
                            .join('\n') +

                            `\n\n🔗 Ranking completo:\n${EDHREC_URL}`
                    )

                    .setColor(
                        0x8b5cf6
                    );

            return interaction.editReply({

                embeds: [embed]
            });
        }

        /* =========================================
           TOP COLORES
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