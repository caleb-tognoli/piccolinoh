import { SlashCommandBuilder } from "discord.js";
import { getOrCreateSessionForGuild } from "../../watchtogether/index.js";
import { info } from "../embeds.js";
import { buildSignedJoinUrl } from "../watchtogetherLink.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Get your personal join link for this server's listening session")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server-only.", ephemeral: true });
      return;
    }
    const session = getOrCreateSessionForGuild(interaction.guildId);
    const displayName =
      interaction.member && "displayName" in interaction.member
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);
    const url = buildSignedJoinUrl({
      sid: session.id,
      uid: interaction.user.id,
      dn: displayName,
      gid: interaction.guildId,
    });
    await interaction.reply({
      embeds: [
        info(
          "Join the session",
          `[Open in browser](${url})\n\nThis link is yours — anyone who opens it will appear in the room as **${displayName}**.`,
        ),
      ],
      ephemeral: true,
    });
  },
};

export default command;
