# HortPro Presence Monitor

A Telegram bot that monitors your child's school presence via the HortPro (elternportal.hortpro.de) system and sends notifications when they arrive at or leave school.

## Features

- Notifications when your child arrives at school
- Notifications when your child leaves school
- Support for multiple children
- Group chat notifications via link keys
- Automatic retry on network failures
- Stops polling after departure to save resources
- Docker support

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Save the bot token

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your bot token:

```
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 3. Run with Docker

```bash
docker compose up -d
```

Or run locally:

```bash
npm install
npm run dev
```

## Usage

### Register (Private Chat)

1. Start a chat with your bot
2. Send `/register`
3. Follow the prompts to enter your HortPro cookies:
   - Log into elternportal.hortpro.de
   - Open DevTools (F12) → Application → Cookies
   - Copy `sid-hep` and `did-hep` values

### Commands

| Command | Where | Description |
|---------|-------|-------------|
| `/start` | Anywhere | Show help |
| `/register` | Private | Set up HortPro cookies |
| `/status` | Anywhere | Show today's presence |
| `/get_key` | Private | Get your link key |
| `/notify_here <key>` | Group | Send notifications to this chat |
| `/stop` | Private | Remove registration |

### Group Notifications

1. Register in private chat → receive a link key
2. Add the bot to your group
3. Send `/notify_here YOUR_KEY` in the group
4. Notifications will now go to the group

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | required | Bot token from BotFather |
| `POLL_INTERVAL_MS` | 120000 | Polling interval (2 min) |
| `POLL_START_HOUR` | 7 | Start polling at 7:00 |
| `POLL_END_HOUR` | 18 | Stop polling at 18:00 |
| `TIMEZONE` | Europe/Berlin | Timezone for times |

## Cookie Expiration

HortPro session cookies expire periodically. When this happens:
1. The bot will notify you
2. Log into HortPro again in your browser
3. Use `/register` to update your cookies

## License

MIT
