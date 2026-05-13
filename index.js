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

                data.card_faces?.[0]
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
            setTimeout(resolve, 6000)
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

                        if (index < 25) {

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

                            if (
                                name
                            ) {

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

        const me =
            channel.guild.members.me;

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
            err.message
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
                    `🔥 Top 25 Commanders - ${weekDate}`
                )

                .setDescription(
                    'Ranking semanal de commanders más populares en EDHREC'
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

        const topText =
            commanders.map(c => {

                const manaIcons =
                    manaToIcons(
                        c.manaCost
                    );

                return `#${c.rank} ${manaIcons} ${c.name}\n📚 ${c.decks} decks`;

            }).join('\n\n');

        mainEmbed.addFields({
            name: '🏆 Ranking',
            value: topText.slice(0, 1024)
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

        /* =========================================
           MENSAJE PRINCIPAL
        ========================================= */

        await channel.send({

            embeds: [
                mainEmbed,
                trendEmbed
            ],

            files: [attachment]
        });

        /* =========================================
           EMBEDS IMAGENES
        ========================================= */

        const imageEmbeds = [];

        commanders.forEach(c => {

            if (!c.image) {
                return;
            }

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

                    .setImage(
                        c.image
                    )

                    .setColor(
                        0x8b5cf6
                    );

            imageEmbeds.push(embed);
        });

        /* =========================================
           ENVIAR IMAGENES EN BLOQUES
        ========================================= */

        for (
            let i = 0;
            i < imageEmbeds.length;
            i += 10
        ) {

            const chunk =
                imageEmbeds.slice(i, i + 10);

            await channel.send({
                embeds: chunk
            });
        }

        console.log(
            'Top enviado correctamente'
        );

    } catch (err) {

        console.error(
            'Error enviando top:',
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

            try {

                const commanders =
                    await getTop25();

                const embeds = [];

                for (
                    let i = 0;
                    i < commanders.length;
                    i += 10
                ) {

                    const chunk =
                        commanders.slice(i, i + 10);

                    const embed =
                        new EmbedBuilder()

                            .setTitle(
                                `🔥 Top Commanders (${i + 1}-${i + chunk.length})`
                            )

                            .setColor(
                                0x8b5cf6
                            )

                            .setTimestamp();

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

                    embeds.push(embed);
                }

                await interaction.editReply({
                    embeds: embeds.slice(0, 10)
                });

            } catch (err) {

                console.error(err);

                await interaction.editReply({
                    content: 'Error obteniendo commanders'
                });
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