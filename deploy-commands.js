require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

/* =========================================
   COLOR COMMANDS
========================================= */

const colorCommands = [

    { name: 'topw', label: 'White (W)' },
    { name: 'topu', label: 'Blue (U)' },
    { name: 'topb', label: 'Black (B)' },
    { name: 'topr', label: 'Red (R)' },
    { name: 'topg', label: 'Green (G)' },
    { name: 'topc', label: 'Colorless (C)' },

    { name: 'topwu', label: 'Azorius (WU)' },
    { name: 'topub', label: 'Dimir (UB)' },
    { name: 'topbr', label: 'Rakdos (BR)' },
    { name: 'toprg', label: 'Gruul (RG)' },
    { name: 'topgw', label: 'Selesnya (GW)' },
    { name: 'topwb', label: 'Orzhov (WB)' },
    { name: 'topur', label: 'Izzet (UR)' },
    { name: 'topbg', label: 'Golgari (BG)' },
    { name: 'toprw', label: 'Boros (RW)' },
    { name: 'topgu', label: 'Simic (GU)' },

    { name: 'topwub', label: 'Esper (WUB)' },
    { name: 'topubr', label: 'Grixis (UBR)' },
    { name: 'topbrg', label: 'Jund (BRG)' },
    { name: 'toprgw', label: 'Naya (RGW)' },
    { name: 'topgwu', label: 'Bant (GWU)' },

    { name: 'toprwb', label: 'Mardu (RWB)' },
    { name: 'topurg', label: 'Temur (URG)' },
    { name: 'topwbg', label: 'Abzan (WBG)' },
    { name: 'topwur', label: 'Jeskai (WUR)' },
    { name: 'topubg', label: 'Sultai (UBG)' },

    { name: 'topwubr', label: 'Yore (WUBR)' },
    { name: 'topubrg', label: 'Glint (UBRG)' },
    { name: 'topwbrg', label: 'Dune (WBRG)' },
    { name: 'topwurg', label: 'Ink (WURG)' },
    { name: 'topwubg', label: 'Witch (WUBG)' },

    { name: 'topwubrg', label: 'Five Color (WUBRG)' }
];

/* =========================================
   COMMANDS
========================================= */

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

/* =========================================
   COLOR COMMANDS
========================================= */

colorCommands.forEach(c => {

    commands.push(

        new SlashCommandBuilder()

            .setName(c.name)

            .setDescription(
                `Top 50 ${c.label} commanders`
            )
    );
});

/* =========================================
   REGISTER
========================================= */

const rest = new REST({
    version: '10'
}).setToken(process.env.TOKEN);

(async () => {

    try {

        console.log(
            'Registrando slash commands...'
        );

        await rest.put(

            Routes.applicationCommands(
                process.env.CLIENT_ID
            ),

            {
                body: commands.map(
                    c => c.toJSON()
                )
            }
        );

        console.log(
            'Slash commands registrados.'
        );

    } catch (error) {

        console.error(error);
    }

})();