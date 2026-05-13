require('dotenv').config();

const fs = require('fs');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    AttachmentBuilder,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionsBitField
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

            if (clean.includes('/')) {
                return `(${clean})`;
            }

            if (clean.includes('P')) {
                return `(${clean})`;
            }

            if (clean === 'X') {
                return '〔X〕';
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

    } catch (err) {

        console.error(
            `Error obteniendo datos de ${name}`,
            err
        );

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

        await page.setUserAgent(
            'Mozilla/5.0'
        );

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

    } catch (err) {

        console.error(
            'Error scraping EDHREC:',
            err
        );

        return [];

    } finally {

        await browser.close();
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
   CAMBIOS RANKING
========================================= */

function compareRanks(current, previous) {

    const changes = [];

    current.forEach(commander => {

        const old =
            previous.find(
                c =>
                    c.name ===
                    commander.name
            );

        if (!old) {

            changes.push(
                `🆕 NEW - ${commander.name}`
            );

            return;
        }

        const diff =
            old.rank -
            commander.rank;

        if (diff > 0) {

            changes.push(
                `⬆️ ${commander.name} sube ${diff}`
            );
        }

        else if (diff < 0) {

            changes.push(
                `⬇️ ${commander.name} baja ${Math.abs(diff)}`
            );
        }
    });

    return changes.slice(0, 10);
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
                fill: false,
                tension: 0.3

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
                    },

                    grid: {
                        color:
                            'rgba(255,255,255,0.1)'
                    }
                },

                x: {

                    ticks: {
                        color: 'white'
                    },

                    grid: {
                        color:
                            'rgba(255,255,255,0.1)'
                    }
                }
            }
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

            console.log(
                'El bot no tiene permisos para bloquear el canal'
            );

            return;
        }

        await channel.permissionOverwrites.edit(
            channel.guild.roles.everyone,
            {
                SendMessages: false
            }
        );

        console.log(
            'Canal bloqueado correctamente'
        );

    } catch (err) {

        console.error(
            'Error bloqueando canal:',
            err
        );
    }
}

/* =========================================
   AVATAR
========================================= */

async function setupBotProfile() {

    try {

        if (!fs.existsSync('./botedh.png')) {
            return;
        }

        const avatar =
            fs.readFileSync('./botedh.png');

        await client.user.setAvatar(
            avatar
        );

        console.log(
            'Avatar actualizado'
        );

    } catch (err) {

        console.log(
            'No se pudo actualizar avatar'
        );
    }
}

/* =========================================
   ENVIAR TOP
========================================= */

async function sendTop(channel) {

    try {

        console.log(
            'Obteniendo top commanders...'
        );

        const commanders =
            await getTopCommanders();

        if (!commanders.length) {

            console.log(
                'No se obtuvieron commanders'
            );

            return;
        }

        const history =
            loadHistory();

        const previous =
            history.length
                ? history[
                    history.length - 1
                ].commanders
                : [];

        const changes =
            compareRanks(
                commanders,
                previous
            );

        history.push({

            date:
                new Date()
                    .toISOString(),

            commanders
        });

        saveHistory(history);

        const weekDate =
            getWeekDate();

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

        /* =========================================
           EMBED PRINCIPAL
        ========================================= */

        const mainEmbed =
            new EmbedBuilder()

                .setTitle(
                    `🔥 Top ${TOP_LIMIT} Commanders - ${weekDate}`
                )

                .setDescription(
                    `Ranking semanal de commanders más populares en EDHREC\n\n🔗 Ver ranking completo:\n${EDHREC_URL}`
                )

                .setColor(0x8b5cf6)

                .setImage(
                    'attachment://ranking.png'
                )

                .setFooter({

                    text:
                        'Datos obtenidos desde EDHREC + Scryfall'
                })

                .setTimestamp();

        await channel.send({

            embeds: [mainEmbed],

            files: [attachment]
        });

        /* =========================================
           TENDENCIAS
        ========================================= */

        const trendEmbed =
            new EmbedBuilder()

                .setTitle(
                    '📈 Tendencias'
                )

                .setDescription(
                    changes.length
                        ? changes.join('\n')
                        : 'Sin cambios'
                )

                .setColor(
                    0x22c55e
                );

        await channel.send({
            embeds: [trendEmbed]
        });

        /* =========================================
           COMANDANTES
        ========================================= */

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

                embed.setImage(
                    c.image
                );
            }

            await channel.send({
                embeds: [embed]
            });
        }

        /* =========================================
           LINK FINAL
        ========================================= */

        await channel.send({
            content:
                `🔗 Ver el ranking completo de commanders:\n${EDHREC_URL}`
        });

        console.log(
            'Top enviado correctamente'
        );

    } catch (err) {

        console.error(
            'ERROR EN sendTop:',
            err
        );
    }
}

/* =========================================
   SLASH COMMANDS
========================================= */

async function registerCommands() {

    const commands = [

        new SlashCommandBuilder()

            .setName(
                'topcommanders'
            )

            .setDescription(
                `Muestra el top ${TOP_LIMIT} commanders`
            )

    ].map(command =>
        command.toJSON()
    );

    const rest =
        new REST({
            version: '10'
        }).setToken(
            process.env.TOKEN
        );

    await rest.put(

        Routes.applicationCommands(
            client.user.id
        ),

        {
            body: commands
        }
    );

    console.log(
        'Slash commands registrados'
    );
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

        await setupBotProfile();

        await registerCommands();

        let channel;

        try {

            channel =
                await client.channels.fetch(
                    process.env.CHANNEL
                );

        } catch (err) {

            console.error(
                'ERROR ACCEDIENDO AL CANAL'
            );

            console.error(err);

            return;
        }

        if (!channel) {
            return;
        }

        await lockChannel(channel);

        await sendTop(channel);

        /* CADA LUNES 12:00 */

        cron.schedule(
            '0 12 * * 1',
            async () => {

                console.log(
                    'Ejecutando top semanal...'
                );

                await sendTop(
                    channel
                );
            }
        );
    }
);

/* =========================================
   SLASH INTERACTION
========================================= */

client.on(
    'interactionCreate',
    async interaction => {

        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        if (
            interaction.commandName ===
            'topcommanders'
        ) {

            await interaction.deferReply();

            const commanders =
                await getTopCommanders();

            if (!commanders.length) {

                await interaction.editReply(
                    'No se pudieron obtener commanders.'
                );

                return;
            }

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
                    )

                    .setTimestamp();

            await interaction.editReply({

                embeds: [embed]
            });
        }
    }
);

/* =========================================
   LOGIN
========================================= */

client.login(
    process.env.TOKEN
);