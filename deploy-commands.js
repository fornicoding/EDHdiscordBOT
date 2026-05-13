// deploy-commands.js

require('dotenv').config();

const {
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

/* =========================================
   EXISTING COMMANDS
========================================= */

const commands = [

    new SlashCommandBuilder()
        .setName('topcommanders')
        .setDescription('Muestra el top 20 commanders')
        .toJSON()

];

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

colorCommands.forEach(c => {

    commands.push(

        new SlashCommandBuilder()
            .setName(c.name)
            .setDescription(`Top 50 ${c.label} commanders`)
            .toJSON()
    );
});

/* =========================================
   REGISTER
========================================= */

const rest =
    new REST({
        version: '10'
    }).setToken(process.env.TOKEN);

(async () => {

    try {

        console.log('Registrando slash commands...');

        await rest.put(

            Routes.applicationCommands(
                process.env.CLIENT_ID
            ),

            {
                body: commands
            }
        );

        console.log('Slash commands registrados.');

    } catch (err) {

        console.error(err);
    }

})();