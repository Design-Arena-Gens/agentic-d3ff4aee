const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Quest system storage
const questQueues = new Map(); // guildId -> { queue: [], active: null, autoEnabled: false }
const userQuests = new Map(); // userId -> { active: [], completed: [] }

// Quest templates
const questTemplates = [
  { id: 1, name: "Slay the Dragon", description: "Defeat the ancient dragon in the mountains", reward: "1000 gold", duration: 300000 },
  { id: 2, name: "Gather Herbs", description: "Collect 10 rare herbs from the forest", reward: "500 gold", duration: 180000 },
  { id: 3, name: "Escort Mission", description: "Safely escort the merchant to the next town", reward: "750 gold", duration: 240000 },
  { id: 4, name: "Dungeon Crawl", description: "Explore the mysterious dungeon and retrieve the artifact", reward: "1500 gold", duration: 420000 },
  { id: 5, name: "Bounty Hunt", description: "Track down and capture the notorious bandit", reward: "2000 gold", duration: 360000 },
];

client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`🎮 Serving ${client.guilds.cache.size} guilds`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const guildId = message.guild.id;

  // Initialize guild queue if needed
  if (!questQueues.has(guildId)) {
    questQueues.set(guildId, { queue: [], active: null, autoEnabled: false, interval: null });
  }

  const guildQueue = questQueues.get(guildId);

  switch (command) {
    case 'help':
      const helpEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🎮 AutoQuest Bot Commands')
        .setDescription('Automatic quest management system')
        .addFields(
          { name: '!autoquest on', value: 'Enable automatic quest queuing', inline: false },
          { name: '!autoquest off', value: 'Disable automatic quest queuing', inline: false },
          { name: '!quest add [id]', value: 'Manually add a quest to the queue', inline: false },
          { name: '!quest list', value: 'Show available quests', inline: false },
          { name: '!queue', value: 'View current quest queue', inline: false },
          { name: '!active', value: 'Show active quest', inline: false },
          { name: '!myquests', value: 'View your quest history', inline: false },
          { name: '!help', value: 'Show this help message', inline: false }
        )
        .setFooter({ text: 'AutoQuest Bot v1.0' });

      await message.reply({ embeds: [helpEmbed] });
      break;

    case 'autoquest':
      if (args[0] === 'on') {
        guildQueue.autoEnabled = true;

        // Start auto-queuing quests every 30 seconds
        if (guildQueue.interval) clearInterval(guildQueue.interval);
        guildQueue.interval = setInterval(() => {
          autoQueueQuest(guildId, message.channel);
        }, 30000);

        const enableEmbed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('✅ AutoQuest Enabled')
          .setDescription('Quests will now be automatically queued every 30 seconds!')
          .setTimestamp();

        await message.reply({ embeds: [enableEmbed] });

        // Queue first quest immediately
        autoQueueQuest(guildId, message.channel);
      } else if (args[0] === 'off') {
        guildQueue.autoEnabled = false;
        if (guildQueue.interval) {
          clearInterval(guildQueue.interval);
          guildQueue.interval = null;
        }

        const disableEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('❌ AutoQuest Disabled')
          .setDescription('Automatic quest queuing has been stopped.')
          .setTimestamp();

        await message.reply({ embeds: [disableEmbed] });
      } else {
        await message.reply('Usage: `!autoquest on` or `!autoquest off`');
      }
      break;

    case 'quest':
      if (args[0] === 'list') {
        const questListEmbed = new EmbedBuilder()
          .setColor('#ffa500')
          .setTitle('📜 Available Quests')
          .setDescription('Use `!quest add [id]` to add a quest to the queue')
          .setTimestamp();

        questTemplates.forEach(quest => {
          questListEmbed.addFields({
            name: `${quest.id}. ${quest.name}`,
            value: `${quest.description}\n💰 Reward: ${quest.reward} | ⏱️ Duration: ${quest.duration / 1000}s`,
            inline: false
          });
        });

        await message.reply({ embeds: [questListEmbed] });
      } else if (args[0] === 'add') {
        const questId = parseInt(args[1]);
        const quest = questTemplates.find(q => q.id === questId);

        if (!quest) {
          await message.reply('❌ Invalid quest ID! Use `!quest list` to see available quests.');
          return;
        }

        guildQueue.queue.push({ ...quest, addedBy: message.author.tag });

        const addEmbed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('✅ Quest Added to Queue')
          .setDescription(`**${quest.name}** has been added to the queue!`)
          .addFields(
            { name: 'Position in Queue', value: `#${guildQueue.queue.length}`, inline: true },
            { name: 'Reward', value: quest.reward, inline: true }
          )
          .setTimestamp();

        await message.reply({ embeds: [addEmbed] });

        // If no active quest, start this one
        if (!guildQueue.active) {
          processNextQuest(guildId, message.channel);
        }
      }
      break;

    case 'queue':
      if (guildQueue.queue.length === 0) {
        await message.reply('📭 The quest queue is empty!');
        return;
      }

      const queueEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📋 Quest Queue')
        .setDescription(`**${guildQueue.queue.length}** quests in queue`)
        .setTimestamp();

      guildQueue.queue.slice(0, 10).forEach((quest, index) => {
        queueEmbed.addFields({
          name: `${index + 1}. ${quest.name}`,
          value: `⏱️ ${quest.duration / 1000}s | Added by: ${quest.addedBy}`,
          inline: false
        });
      });

      if (guildQueue.queue.length > 10) {
        queueEmbed.setFooter({ text: `... and ${guildQueue.queue.length - 10} more quests` });
      }

      await message.reply({ embeds: [queueEmbed] });
      break;

    case 'active':
      if (!guildQueue.active) {
        await message.reply('📭 No quest is currently active!');
        return;
      }

      const activeEmbed = new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle('⚔️ Active Quest')
        .addFields(
          { name: 'Quest', value: guildQueue.active.name, inline: false },
          { name: 'Description', value: guildQueue.active.description, inline: false },
          { name: 'Reward', value: guildQueue.active.reward, inline: true },
          { name: 'Status', value: '🔄 In Progress', inline: true }
        )
        .setTimestamp();

      await message.reply({ embeds: [activeEmbed] });
      break;

    case 'myquests':
      if (!userQuests.has(message.author.id)) {
        await message.reply('You haven\'t completed any quests yet!');
        return;
      }

      const userQuestData = userQuests.get(message.author.id);
      const myQuestsEmbed = new EmbedBuilder()
        .setColor('#9900ff')
        .setTitle(`📊 ${message.author.username}'s Quests`)
        .addFields(
          { name: 'Completed Quests', value: `${userQuestData.completed.length}`, inline: true },
          { name: 'Total Rewards', value: `${userQuestData.completed.length * 1000} gold`, inline: true }
        )
        .setTimestamp();

      if (userQuestData.completed.length > 0) {
        const recentQuests = userQuestData.completed.slice(-5).reverse();
        myQuestsEmbed.addFields({
          name: 'Recent Completions',
          value: recentQuests.map(q => `✅ ${q.name}`).join('\n'),
          inline: false
        });
      }

      await message.reply({ embeds: [myQuestsEmbed] });
      break;
  }
});

function autoQueueQuest(guildId, channel) {
  const guildQueue = questQueues.get(guildId);
  if (!guildQueue || !guildQueue.autoEnabled) return;

  // Pick a random quest
  const randomQuest = questTemplates[Math.floor(Math.random() * questTemplates.length)];
  guildQueue.queue.push({ ...randomQuest, addedBy: 'AutoQueue System' });

  const autoQueueEmbed = new EmbedBuilder()
    .setColor('#ffcc00')
    .setTitle('🤖 Quest Auto-Queued')
    .setDescription(`**${randomQuest.name}** has been automatically added!`)
    .addFields(
      { name: 'Queue Position', value: `#${guildQueue.queue.length}`, inline: true },
      { name: 'Reward', value: randomQuest.reward, inline: true }
    )
    .setTimestamp();

  channel.send({ embeds: [autoQueueEmbed] });

  // If no active quest, start this one
  if (!guildQueue.active) {
    processNextQuest(guildId, channel);
  }
}

function processNextQuest(guildId, channel) {
  const guildQueue = questQueues.get(guildId);
  if (!guildQueue || guildQueue.queue.length === 0) return;

  // Get next quest from queue
  const quest = guildQueue.queue.shift();
  guildQueue.active = quest;

  const startEmbed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('⚔️ Quest Started!')
    .setDescription(`**${quest.name}** is now active!`)
    .addFields(
      { name: 'Description', value: quest.description, inline: false },
      { name: 'Reward', value: quest.reward, inline: true },
      { name: 'Duration', value: `${quest.duration / 1000}s`, inline: true }
    )
    .setTimestamp();

  channel.send({ embeds: [startEmbed] });

  // Complete quest after duration
  setTimeout(() => {
    completeQuest(guildId, channel);
  }, quest.duration);
}

function completeQuest(guildId, channel) {
  const guildQueue = questQueues.get(guildId);
  if (!guildQueue || !guildQueue.active) return;

  const completedQuest = guildQueue.active;

  const completeEmbed = new EmbedBuilder()
    .setColor('#gold')
    .setTitle('🎉 Quest Completed!')
    .setDescription(`**${completedQuest.name}** has been completed!`)
    .addFields(
      { name: '💰 Reward Earned', value: completedQuest.reward, inline: true },
      { name: '📋 Remaining in Queue', value: `${guildQueue.queue.length}`, inline: true }
    )
    .setTimestamp();

  channel.send({ embeds: [completeEmbed] });

  guildQueue.active = null;

  // Process next quest if available
  if (guildQueue.queue.length > 0) {
    setTimeout(() => {
      processNextQuest(guildId, channel);
    }, 2000);
  }
}

// Login to Discord
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN is not set in environment variables!');
  process.exit(1);
}

client.login(token).catch(err => {
  console.error('❌ Failed to login:', err.message);
  process.exit(1);
});
