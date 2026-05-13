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
    Routes
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

async function getTop25() {

    const browser = await puppeteer.launch({
        headless: true,

        executablePath:
            process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    try {

        const page = await browser.newPage();

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );

        await page.goto('https://edhrec.com/commanders', {
            waitUntil: 'domcontentloaded',
            timeout: 0
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        const data = await page.evaluate(() => {

            const cards =
                document.querySelectorAll('[class*="Card_container"]');

            const results = [];

            cards.forEach((card, index) => {

                if (index < 25) {

                    const name =
                        card.querySelector('[class*="Card_name"]')
                        ?.innerText
                        ?.trim();

                    const rank =
                        card.querySelector('[class*="CardLabel_rank"]')
                        ?.innerText
                        ?.innerText
                        ?.trim();

                    const decksMatch =
                        card.innerText.match(/([\d,.]+)\s*decks/i);

                    const decks =
                        decksMatch
                            ? decksMatch[1]
                            : 'Unknown';

                    const image =
                        card.querySelector('img')
                        ?.src;

                    if (name && rank) {

                        results.push({
                            rank: Number(rank),
                            name,
                            decks,
                            image
                        });
                    }
                }
            });

            return results;
        });

        return data;

    } catch (err) {

        console.error('Error scraping EDHREC:', err);

        return [];

    } finally {

        await browser.close();
    }
}

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

function compareRanks(current, previous) {

    const changes = [];

    current.forEach(commander => {

        const old =
            previous.find(
                c => c.name === commander.name
            );

        if (!old) {

            changes.push(
                `🆕 NEW - ${commander.name}`
            );

            return;
        }

        const diff =
            old.rank - commander.rank;

        if (diff > 0) {

            changes.push(
                `⬆️ ${commander.name} sube ${diff} puestos`
            );
        }

        else if (diff < 0) {

            changes.push(
                `⬇️ ${commander.name} baja ${Math.abs(diff)} puestos`
            );
        }
    });

    return changes.slice(0, 10);
}

async function createChart(history) {

    const width = 1000;
    const height = 500;

    const chartJSNodeCanvas =
        new ChartJSNodeCanvas({
            width,
            height
        });

    const latest = history.slice(-5);

    const commanders = {};

    latest.forEach(week => {

        week.commanders.forEach(c => {

            if (!commanders[c.name]) {
                commanders[c.name] = [];
            }

            commanders[c.name].push(c.rank);
        });
    });

    const datasets = Object.entries(commanders)
        .slice(0, 5)
        .map(([name, ranks]) => ({

            label: name,
            data: ranks,
            fill: false

        }));

    const configuration = {

        type: 'line',

        data: {

            labels: latest.map(
                (_, i) => `Week ${i + 1}`
            ),

            datasets
        },

        options: {

            responsive: false,

            scales: {

                y: {

                    reverse: true,
                    beginAtZero: false
                }
            }
        }
    };

    const image =
        await chartJSNodeCanvas.renderToBuffer(configuration);

    const path =
        './data/charts/ranking.png';

    fs.writeFileSync(path, image);

    return path;
}

async function sendTop(channel) {

    console.log('Obteniendo top commanders...');

    const commanders =
        await getTop25();

    if (!commanders.length) {

        console.log('No se obtuvieron commanders');

        return;
    }

    const history =
        loadHistory();

    const previous =
        history.length
            ? history[history.length - 1].commanders
            : [];

    const changes =
        compareRanks(commanders, previous);

    history.push({

        date: new Date().toISOString(),
        commanders
    });

    saveHistory(history);

    const description = commanders
        .map(c => {

            return `#${c.rank} - **${c.name}** (${c.decks} decks)`;

        })
        .join('\n');

    const embed = new EmbedBuilder()
        .setTitle('🔥 Top 25 Commanders EDHREC')
        .setDescription(description)
        .setColor(0x8b5cf6)
        .setThumbnail(commanders[0]?.image)
        .addFields({

            name: '📈 Tendencias',

            value:
                changes.length
                    ? changes.join('\n')
                    : 'Sin cambios'

        })
        .setFooter({

            text: 'Datos obtenidos desde EDHREC'
        })
        .setTimestamp();

    const chartPath =
        await createChart(history);

    const attachment =
        new AttachmentBuilder(chartPath);

    await channel.send({

        embeds: [embed],
        files: [attachment]
    });

    console.log('Top enviado correctamente');
}

async function registerCommands() {

    const commands = [

        new SlashCommandBuilder()
            .setName('topcommanders')
            .setDescription(
                'Muestra el top 25 commanders'
            )

    ].map(command => command.toJSON());

    const rest = new REST({
        version: '10'
    }).setToken(process.env.TOKEN);

    await rest.put(

        Routes.applicationCommands(
            client.user.id
        ),

        {
            body: commands
        }
    );

    console.log('Slash commands registrados');
}

client.once('ready', async () => {

    console.log(
        `Conectado como ${client.user.tag}`
    );

    await registerCommands();

    const channel =
        await client.channels.fetch(
            process.env.CHANNEL_ID
        );

    await sendTop(channel);

    cron.schedule(
        '0 12 * * 1',
        async () => {

            console.log(
                'Ejecutando top semanal...'
            );

            await sendTop(channel);

        }
    );
});

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName === 'topcommanders') {

        await interaction.deferReply();

        const commanders =
            await getTop25();

        const text = commanders
            .map(c => {

                return `#${c.rank} - ${c.name}`;

            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(
                '🔥 Top 25 Commanders'
            )
            .setDescription(text)
            .setColor(0x8b5cf6)
            .setTimestamp();

        await interaction.editReply({

            embeds: [embed]
        });
    }
});

client.login(process.env.TOKEN);