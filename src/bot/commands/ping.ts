import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),

  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pinging…",
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    const roundTrip = (sent.resource?.message?.createdTimestamp ?? Date.now()) - interaction.createdTimestamp;
    const gateway = interaction.client.ws.ping;

    await interaction.editReply(`Pong! Gateway: ${gateway}ms · Round-trip: ${roundTrip}ms`);
  },
};

export default command;
