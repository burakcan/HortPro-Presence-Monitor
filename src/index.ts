import { Bot, Context, session, SessionFlavor } from "grammy";
import { loadConfig, type Config } from "./config.js";
import { HortProClient } from "./hortpro.js";
import {
  loadState,
  saveState,
  getUser,
  setUser,
  removeUser,
  getUserState,
  getUserByLinkKey,
  getUserByNotifyChatId,
  generateLinkKey,
  isArrivalNotified,
  isDepartureNotified,
  markArrivalNotified,
  markDepartureNotified,
  isKidCompletedToday,
  markKidCompleted,
  cleanupOldState,
} from "./state.js";

import type { AppState, UserRegistration } from "./types.js";

interface SessionData {
  step?: "awaiting_sid" | "awaiting_did";
  tempSid?: string;
}

type MyContext = Context & SessionFlavor<SessionData>;

function formatTime(isoTime: string, timezone: string): string {
  const date = new Date(isoTime);
  return date.toLocaleTimeString("de-DE", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isWithinPollingHours(config: Config): boolean {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleString("en-US", {
      timeZone: config.timezone,
      hour: "numeric",
      hour12: false,
    }),
    10
  );
  return hour >= config.polling.startHour && hour < config.polling.endHour;
}

async function sendWithRetry(
  bot: Bot<MyContext>,
  chatId: number,
  message: string,
  retries = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
      return true;
    } catch (error: unknown) {
      const err = error as { description?: string; error_code?: number };
      console.error(
        `[${chatId}] Send attempt ${attempt}/${retries} failed:`,
        err.description || error
      );

      // Don't retry if it's a permissions/bot-not-in-chat error
      if (
        err.error_code === 403 ||
        err.description?.includes("bot was blocked") ||
        err.description?.includes("chat not found") ||
        err.description?.includes("not a member")
      ) {
        console.error(`[${chatId}] Permanent error, not retrying`);
        return false;
      }

      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // Exponential backoff
      }
    }
  }
  return false;
}

async function checkUserPresences(
  bot: Bot<MyContext>,
  config: Config,
  state: AppState,
  user: UserRegistration
): Promise<void> {
  const client = new HortProClient(config, user.sidCookie, user.didCookie);
  const userState = getUserState(state, user.chatId);
  cleanupOldState(userState);

  const targetChatId = user.notifyChatId || user.chatId;

  for (const kid of user.kids) {
    // Skip kids who have already left for the day
    if (isKidCompletedToday(userState, kid.id)) {
      continue;
    }
    let presences;
    try {
      presences = await client.getPresencesForToday(kid.id);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(
        `[${user.chatId}] Error fetching presences for ${kid.first_name}: ${errorMsg}`
      );

      // Handle expired cookies
      if (
        errorMsg.includes("401") ||
        errorMsg.includes("403") ||
        errorMsg.includes("Unauthorized")
      ) {
        await sendWithRetry(
          bot,
          user.chatId, // Always notify private chat about auth issues
          `Your HortPro session has expired. Please use /register to set up new cookies.`
        );
        removeUser(state, user.chatId);
        return;
      }
      continue;
    }

    for (const presence of presences) {
      // Check arrival (date_start)
      if (presence.date_start && !isArrivalNotified(userState, presence.id)) {
        const time = formatTime(presence.date_start, config.timezone);
        console.log(
          `[${user.chatId}] New arrival: ${kid.first_name} at ${time}`
        );
        const sent = await sendWithRetry(
          bot,
          targetChatId,
          `<b>${kid.first_name}</b> arrived at school at <b>${time}</b>`
        );
        if (sent) {
          markArrivalNotified(userState, presence.id);
        }
      }

      // Check departure (date_end)
      if (presence.date_end && !isDepartureNotified(userState, presence.id)) {
        const time = formatTime(presence.date_end, config.timezone);
        console.log(
          `[${user.chatId}] New departure: ${kid.first_name} at ${time}`
        );
        const sent = await sendWithRetry(
          bot,
          targetChatId,
          `<b>${kid.first_name}</b> left school at <b>${time}</b>`
        );
        if (sent) {
          markDepartureNotified(userState, presence.id);
          markKidCompleted(userState, kid.id);
          console.log(
            `[${user.chatId}] ${kid.first_name} completed for today, skipping until tomorrow`
          );
        }
      }
    }
  }

  // Check if cookies were refreshed and save them
  const updatedCookies = client.getUpdatedCookies();
  if (updatedCookies) {
    user.sidCookie = updatedCookies.sidCookie;
    user.didCookie = updatedCookies.didCookie;
    setUser(state, user.chatId, user);
    console.log(`[${user.chatId}] Cookies updated and saved`);
  }
}

// Keep all user sessions alive (runs 24/7)
async function keepSessionsAlive(config: Config): Promise<void> {
  const state = await loadState();
  const users = Object.values(state.users);

  if (users.length === 0) {
    return;
  }

  for (const user of users) {
    try {
      const client = new HortProClient(config, user.sidCookie, user.didCookie);
      const sessionValid = await client.pingSession();
      if (!sessionValid) {
        console.log(`[${user.chatId}] Session ping failed, may be expired`);
      }
    } catch (error) {
      console.error(`[${user.chatId}] Session keepalive error:`, error);
    }
  }
}

async function pollAllUsers(
  bot: Bot<MyContext>,
  config: Config
): Promise<void> {
  if (!isWithinPollingHours(config)) {
    return;
  }

  const state = await loadState();
  const users = Object.values(state.users);

  if (users.length === 0) {
    return;
  }

  console.log(
    `[${new Date().toISOString()}] Checking ${users.length} user(s)...`
  );

  for (const user of users) {
    try {
      await checkUserPresences(bot, config, state, user);
    } catch (error) {
      console.error(`[${user.chatId}] Poll error:`, error);
    }
  }

  await saveState(state);
}

async function main(): Promise<void> {
  console.log("Starting HortPro Presence Monitor Bot...");

  const config = loadConfig();
  const bot = new Bot<MyContext>(config.telegram.botToken);

  // Session middleware for registration flow
  bot.use(
    session({
      initial: (): SessionData => ({}),
    })
  );

  // /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      `Welcome to HortPro Presence Monitor!\n\n` +
        `I'll notify you when your child arrives at or leaves school.\n\n` +
        `<b>Commands:</b>\n` +
        `/register - Set up your HortPro cookies (private chat only)\n` +
        `/status - Check today's presence status\n` +
        `/get_key - Get your link key for group notifications\n` +
        `/notify_here &lt;key&gt; - Send notifications to this chat\n` +
        `/stop - Stop monitoring and remove your data`,
      { parse_mode: "HTML" }
    );
  });

  // /register command
  bot.command("register", async (ctx) => {
    // In groups, recommend private chat for security
    if (ctx.chat.type !== "private") {
      await ctx.reply(
        `For security reasons, please register in a private chat.\n\n` +
          `Click here: @${ctx.me.username}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.reply(
      `Let's set up your HortPro connection.\n\n` +
        `You'll need to get your session cookies from the browser:\n` +
        `1. Log into elternportal.hortpro.de\n` +
        `2. Open DevTools (F12) → Application → Cookies\n` +
        `3. Copy the <code>sid-hep</code> cookie value\n\n` +
        `Please send me your <b>sid-hep</b> cookie value now:`,
      { parse_mode: "HTML" }
    );
    ctx.session.step = "awaiting_sid";
  });

  // /status command
  bot.command("status", async (ctx) => {
    const state = await loadState();
    // Try direct registration first, then check if this chat is linked
    const user =
      getUser(state, ctx.chat.id) || getUserByNotifyChatId(state, ctx.chat.id);

    if (!user) {
      await ctx.reply(
        "No registration found for this chat.\n" +
          "Use /register in private chat, then /notify_here to link this group."
      );
      return;
    }

    await ctx.reply("Fetching today's status...");

    const client = new HortProClient(config, user.sidCookie, user.didCookie);
    const statusLines: string[] = [];

    for (const kid of user.kids) {
      try {
        const presences = await client.getPresencesForToday(kid.id);
        const todayPresence = presences[0]; // Most recent first

        if (todayPresence) {
          const arrivalTime = formatTime(
            todayPresence.date_start,
            config.timezone
          );

          if (todayPresence.date_end) {
            // Already left
            const departureTime = formatTime(
              todayPresence.date_end,
              config.timezone
            );
            const durationMins = todayPresence.duration || 0;
            const hours = Math.floor(durationMins / 60);
            const mins = durationMins % 60;
            const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

            statusLines.push(
              `<b>${kid.first_name}</b>\n` +
                `  Arrived: ${arrivalTime}\n` +
                `  Left: ${departureTime}\n` +
                `  Duration: ${durationStr}`
            );
          } else {
            // Still at school
            const arrivalDate = new Date(todayPresence.date_start);
            const now = new Date();
            const durationMins = Math.floor(
              (now.getTime() - arrivalDate.getTime()) / 60000
            );
            const hours = Math.floor(durationMins / 60);
            const mins = durationMins % 60;
            const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

            statusLines.push(
              `<b>${kid.first_name}</b>\n` +
                `  Arrived: ${arrivalTime}\n` +
                `  Still at school (${durationStr})`
            );
          }
        } else {
          statusLines.push(
            `<b>${kid.first_name}</b>\n  No presence recorded today`
          );
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        statusLines.push(`<b>${kid.first_name}</b>\n  Error: ${errorMsg}`);
      }
    }

    // Save refreshed cookies if any
    const updatedCookies = client.getUpdatedCookies();
    if (updatedCookies) {
      user.sidCookie = updatedCookies.sidCookie;
      user.didCookie = updatedCookies.didCookie;
      setUser(state, user.chatId, user);
      await saveState(state);
      console.log(`[${user.chatId}] Cookies updated and saved`);
    }

    const header = `<b>Today's Status</b>\n\n`;
    const footer = `\n\nPolling hours: ${config.polling.startHour}:00 - ${config.polling.endHour}:00`;

    await ctx.reply(header + statusLines.join("\n\n") + footer, {
      parse_mode: "HTML",
    });
  });

  // /stop command
  bot.command("stop", async (ctx) => {
    const state = await loadState();
    const user = getUser(state, ctx.chat.id);

    if (!user) {
      await ctx.reply("You're not registered.");
      return;
    }

    removeUser(state, ctx.chat.id);
    await saveState(state);
    await ctx.reply("Monitoring stopped. Your data has been removed.");
  });

  // /get_key command
  bot.command("get_key", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply("This command only works in private chat.");
      return;
    }

    const state = await loadState();
    const user = getUser(state, ctx.chat.id);

    if (!user) {
      await ctx.reply("You're not registered. Use /register first.");
      return;
    }

    const notifyLocation =
      user.notifyChatId === user.chatId
        ? "this private chat"
        : "a linked group";

    await ctx.reply(
      `Your link key: <code>${user.linkKey}</code>\n\n` +
        `Notifications are sent to: ${notifyLocation}\n\n` +
        `Use <code>/notify_here ${user.linkKey}</code> in a group to change where notifications are sent.`,
      { parse_mode: "HTML" }
    );
  });

  // /notify_here command
  bot.command("notify_here", async (ctx) => {
    const linkKey = ctx.match?.trim();

    if (!linkKey) {
      await ctx.reply(
        "Usage: <code>/notify_here YOUR_KEY</code>\n\n" +
          "Get your key by using /get_key in a private chat with the bot.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const state = await loadState();
    const user = getUserByLinkKey(state, linkKey);

    if (!user) {
      await ctx.reply(
        "Invalid key. Use /get_key in private chat to get your key."
      );
      return;
    }

    // Update the notification target
    user.notifyChatId = ctx.chat.id;
    setUser(state, user.chatId, user);
    await saveState(state);

    const kidNames = user.kids.map((k) => k.first_name).join(", ");
    await ctx.reply(
      `Notifications for <b>${kidNames}</b> will now be sent to this chat.`,
      { parse_mode: "HTML" }
    );
  });

  // Handle text messages (for registration flow)
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();

    if (ctx.session.step === "awaiting_sid") {
      if (!text.startsWith("Fe26.2")) {
        await ctx.reply(
          "That doesn't look like a valid sid-hep cookie (should start with Fe26.2).\n" +
            "Please try again or use /register to restart."
        );
        return;
      }

      ctx.session.tempSid = text;
      ctx.session.step = "awaiting_did";
      await ctx.reply(
        `Got it! Now please send me your <b>did-hep</b> cookie value:`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (ctx.session.step === "awaiting_did") {
      if (!text.startsWith("Fe26.2")) {
        await ctx.reply(
          "That doesn't look like a valid did-hep cookie (should start with Fe26.2).\n" +
            "Please try again or use /register to restart."
        );
        return;
      }

      const sidCookie = ctx.session.tempSid!;
      const didCookie = text;

      // Clear session
      ctx.session.step = undefined;
      ctx.session.tempSid = undefined;

      await ctx.reply("Verifying your cookies...");

      try {
        const client = new HortProClient(config, sidCookie, didCookie);
        const kids = await client.getKids();

        if (kids.length === 0) {
          await ctx.reply(
            "No children found on your account. Please check your cookies."
          );
          return;
        }

        const state = await loadState();
        const linkKey = generateLinkKey();
        const registration: UserRegistration = {
          chatId: ctx.chat.id,
          sidCookie,
          didCookie,
          kids,
          registeredAt: new Date().toISOString(),
          linkKey,
          notifyChatId: ctx.chat.id, // Default to private chat
        };
        setUser(state, ctx.chat.id, registration);
        await saveState(state);

        const kidNames = kids
          .map((k) => `${k.first_name} (${k.kid_group})`)
          .join(", ");
        await ctx.reply(
          `Registration successful!\n\n` +
            `Monitoring: <b>${kidNames}</b>\n\n` +
            `Your link key: <code>${linkKey}</code>\n` +
            `Use <code>/notify_here ${linkKey}</code> in a group to receive notifications there.\n\n` +
            `Active hours: ${config.polling.startHour}:00 - ${config.polling.endHour}:00`,
          { parse_mode: "HTML" }
        );

        // Do an immediate check
        await checkUserPresences(bot, config, state, registration);
        await saveState(state);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Registration error for ${ctx.chat.id}:`, errorMsg);
        await ctx.reply(
          `Failed to verify cookies: ${errorMsg}\n\n` +
            `Please make sure you're logged in and try /register again.`
        );
      }
      return;
    }

    // Default response for unknown messages
    await ctx.reply("Use /start to see available commands.");
  });

  // Session keepalive loop (runs 24/7 to prevent session expiration)
  const keepaliveIntervalMs = 5 * 60 * 1000; // 5 minutes
  setInterval(() => {
    keepSessionsAlive(config).catch(console.error);
  }, keepaliveIntervalMs);

  // Start polling loop (only during school hours)
  setInterval(() => {
    pollAllUsers(bot, config).catch(console.error);
  }, config.polling.intervalMs);

  // Initial poll
  setTimeout(() => {
    pollAllUsers(bot, config).catch(console.error);
  }, 5000);

  console.log(`Session keepalive: every 5 minutes (24/7)`);
  console.log(`Presence polling: every ${config.polling.intervalMs / 1000} seconds (${config.polling.startHour}:00 - ${config.polling.endHour}:00 ${config.timezone})`);

  // Start bot
  bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} started!`);
    },
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
