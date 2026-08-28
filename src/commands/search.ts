import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Command } from "./_types.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Look up a track without playing it")
    .addStringOption((o) =>
      o.setName("query").setDescription("Track name or URL").setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const query = interaction.options.getString("query", true);
    const node = interaction.client.shoukaku.getIdealNode();

    if (!node) {
      await interaction.editReply("No audio node available.");
      return;
    }

    const identifier = /^https?:\/\//i.test(query) ? query : `ytsearch:${query}`;
    const res = await node.rest.resolve(identifier);

    if (!res || res.loadType === "empty") {
      await interaction.editReply("No results.");
      return;
    }
    if (res.loadType === "error") {
      const message = res.data.message ?? "unknown";
      await interaction.editReply(`Error: ${message}`);
      return;
    }

    const track =
      res.loadType === "playlist"
        ? res.data.tracks[0]
        : res.loadType === "search"
          ? res.data[0]
          : res.data;

    if (!track) {
      await interaction.editReply("No results.");
      return;
    }

    const uri = track.info.uri ? `\n${track.info.uri}` : "";
    await interaction.editReply(`**${track.info.title}** — ${track.info.author}${uri}`);
  },
};

export default command;
