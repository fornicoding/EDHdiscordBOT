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

const BOT_NAME = 'Top Commanders';

/* =========================================
   ICONOS COLORES MANA
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

            if (
                clean === 'W' ||
                clean === 'U' ||
                clean === 'B' ||
                clean === 'R' ||
                clean === 'G'
            ) {

                return COLOR_MAP[clean];
            }

            if (!isNaN(clean)) {
                return `〔${clean}〕`;
            }

            return `(${clean})`;

        })
        .join('');
}

/* =========================================
   FECHA SEMANA
========================================= */

function getWeekRange() {

    const now = new Date();

    const first =
        new Date(now);

    const last =
        new Date(now);

    const day =
        now.getDay();

    const diffToMonday =
        day === 0
            ? -6
            : 1 - day;

    first.setDate(
        now.getDate() + diffToMonday
    );

    last.setDate(
        first.getDate() + 6
    );

    const format = date =>
        date.toLocaleDateString(
            'es-ES',
            {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }
        );

    return `${format(first)} - ${format(last)}`;
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

                data.card_faces?.[0]
                    ?.mana_cost ||

                '',

            image:
                data.image_uris?.normal ||

                data.card_faces?.[0]
                    ?.image_uris?.normal ||

                data.card_faces?.[1]
                    ?.image_uris?.normal ||

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

async function getTop25() {

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
            'https://edhrec.com/commanders',
            {
                waitUntil: 'domcontentloaded',
                timeout: 0
            }
        );

        await new Promise(resolve =>
            setTimeout(resolve, 5000)
        );

        const data =
            await page.evaluate(() => {

                const cards =
                    document.querySelectorAll(
                        '[class*="Card_container"]'
                    );

                const results = [];

                cards.forEach(
                    (card, index) => {

                        if (results.length < 25) {

                            const name =
                                card.querySelector(
                                    '[class*="Card_name"]'
                                )
                                ?.innerText
                                ?.trim();

                            const rank =
                                card.querySelector(
                                    '[class*="CardLabel_rank"]'
                                )
                                ?.innerText
                                ?.trim();

                            const decksMatch =
                                card.innerText.match(
                                    /([\d,.]+)\s*decks/i
                                );

                            const decks =
                                decksMatch
                                    ? decksMatch[1]
                                    : 'Unknown';

                            if (
                                name &&
                                rank
                            ) {

                                results.push({
                                    rank:
                                        Number(rank),
                                    name,
                                    decks
                                });
                            }
                        }
                    }
                );

                return results;
            });

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

    return changes.slice(0, 5);
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
            backgroundColour: '#111827'
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
   FOTO PERFIL + NOMBRE
========================================= */

async function setupBotProfile() {

    try {

        if (
            fs.existsSync('./botedh.png')
        ) {

            const avatar =
                fs.readFileSync(
                    './botedh.png'
                );

            await client.user.setAvatar(
                avatar
            );

            console.log(
                'Avatar actualizado'
            );
        }

        await client.user.setUsername(
            BOT_NAME
        );

        console.log(
            'Nombre actualizado'
        );

    } catch (err) {

        console.error(
            'Error configurando perfil:',
            err.message
        );
    }
}

/* =========================================
   ENVIAR TOP
========================================= */

async function sendTop(channel) {

    console.log(
        'Obteniendo top commanders...'
    );

    const commanders =
        await getTop25();

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

    const weekRange =
        getWeekRange();

    /* =========================================
       EMBED PRINCIPAL
    ========================================= */

    const embed =
        new EmbedBuilder()

            .setTitle(
                `🔥 Top 25 Commanders EDHREC`
            )

            .setDescription(
                `📅 Semana: ${weekRange}`
            )

            .setColor(0x8b5cf6)

            .setFooter({

                text:
                    'Datos obtenidos desde EDHREC + Scryfall'
            })

            .setTimestamp();

    /* =========================================
       SOLO 24 FIELDS
       (Discord máximo 25)
    ========================================= */

    const top24 =
        commanders.slice(0, 24);

    top24.forEach(c => {

        const manaIcons =
            manaToIcons(
                c.manaCost
            );

        embed.addFields({

            name:
                `#${c.rank} ${manaIcons} ${c.name}`,

            value:
                `[🖼️ Ver carta](${c.image || 'https://cards.scryfall.io'} )\n📚 ${c.decks} decks`,

            inline: false
        });
    });

    /* =========================================
       TENDENCIAS = FIELD 25
    ========================================= */

    embed.addFields({

        name: '📈 Tendencias',

        value:
            changes.length
                ? changes.join('\n')
                : 'Sin cambios'
    });

    const chartPath =
        await createChart(
            history
        );

    const attachment =
        new AttachmentBuilder(
            chartPath
        );

    /* =========================================
       ENVIAR IMÁGENES DE LAS 25 CARTAS
    ========================================= */

    for (const c of commanders) {

        if (c.image) {

            const cardEmbed =
                new EmbedBuilder()

                    .setTitle(
                        `#${c.rank} ${c.name}`
                    )

                    .setImage(c.image)

                    .setColor(
                        0x8b5cf6
                    );

            await channel.send({
                embeds: [cardEmbed]
            });
        }
    }

    /* =========================================
       ENVIAR EMBED PRINCIPAL
    ========================================= */

    await channel.send({

        embeds: [embed],

        files: [attachment]
    });

    console.log(
        'Top enviado correctamente'
    );
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
                'Muestra el top 25 commanders'
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

        await lockChannel(channel);

        await sendTop(channel);

        /* =========================================
           TODOS LOS LUNES A LAS 12
        ========================================= */

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
                await getTop25();

            const embed =
                new EmbedBuilder()

                    .setTitle(
                        '🔥 Top 25 Commanders'
                    )

                    .setDescription(
                        `📅 Semana: ${getWeekRange()}`
                    )

                    .setColor(
                        0x8b5cf6
                    )

                    .setTimestamp();

            const top24 =
                commanders.slice(0, 24);

            top24.forEach(c => {

                const manaIcons =
                    manaToIcons(
                        c.manaCost
                    );

                embed.addFields({

                    name:
                        `#${c.rank} ${manaIcons} ${c.name}`,

                    value:
                        `[🖼️ Ver carta](${c.image || 'https://cards.scryfall.io'})\n📚 ${c.decks} decks`,

                    inline: false
                });
            });

            embed.addFields({

                name: '📈 Info',

                value:
                    'Usa las imágenes enviadas debajo para ver las cartas completas.'
            });

            await interaction.editReply({

                embeds: [embed]
            });

            for (const c of commanders) {

                if (c.image) {

                    const cardEmbed =
                        new EmbedBuilder()

                            .setTitle(
                                `#${c.rank} ${c.name}`
                            )

                            .setImage(
                                c.image
                            )

                            .setColor(
                                0x8b5cf6
                            );

                    await interaction.followUp({
                        embeds: [cardEmbed]
                    });
                }
            }
        }
    }
);

/* =========================================
   LOGIN
========================================= */

client.login(
    process.env.TOKEN
);