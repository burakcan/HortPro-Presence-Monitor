export interface Config {
  telegram: {
    botToken: string;
  };
  hortpro: {
    baseUrl: string;
    clientVersion: string;
  };
  polling: {
    intervalMs: number;
    startHour: number;
    endHour: number;
  };
  timezone: string;
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function loadConfig(): Config {
  return {
    telegram: {
      botToken: getEnvOrThrow("TELEGRAM_BOT_TOKEN"),
    },
    hortpro: {
      baseUrl: "https://elternportal.hortpro.de",
      clientVersion: "1.14.1",
    },
    polling: {
      intervalMs: parseInt(getEnvOrDefault("POLL_INTERVAL_MS", "120000"), 10),
      startHour: parseInt(getEnvOrDefault("POLL_START_HOUR", "7"), 10),
      endHour: parseInt(getEnvOrDefault("POLL_END_HOUR", "18"), 10),
    },
    timezone: getEnvOrDefault("TIMEZONE", "Europe/Berlin"),
  };
}
