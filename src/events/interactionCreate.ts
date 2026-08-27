import { MessageFlags } from "discord.js";
import { logger } from "../logger.js";
import type { DodanteClient } from "../client.js";

export function registerInteractionCreate(client: DodanteClient): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn({ name: interaction.commandName }, "unknown command invoked");
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, "command failed");
      const message = "Something went wrong.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
}
