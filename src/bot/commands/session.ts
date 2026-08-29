import { SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { buildJoinUrl } from "../watchtogetherLink.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("session")
    .setDescription("Post the join link for this server's listening session")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    const url = buildJoinUrl(session.id);
    await interaction.reply(`Join here: ${url}`);
  },
};

export default command;
