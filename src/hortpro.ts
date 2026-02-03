import type { Config } from "./config.js";
import type { Kid, KidsResponse, Presence, PresencesResponse } from "./types.js";

export class HortProClient {
  private config: Config;
  private sidCookie: string;
  private didCookie: string;

  constructor(config: Config, sidCookie: string, didCookie: string) {
    this.config = config;
    this.sidCookie = sidCookie;
    this.didCookie = didCookie;
  }

  private getHeaders(): Record<string, string> {
    return {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-DE,en;q=0.9",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      "client-version": this.config.hortpro.clientVersion,
      "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      Cookie: `sid-hep=${this.sidCookie}; did-hep=${this.didCookie}`,
    };
  }

  async getKids(): Promise<Kid[]> {
    const url = `${this.config.hortpro.baseUrl}/api/kids`;

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch kids: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = (await response.json()) as KidsResponse;
    if (!data.success) {
      throw new Error("API returned success: false");
    }
    return data.data || [];
  }

  async getPresencesForToday(kidId: string): Promise<Presence[]> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    // Filter format: date_start <= endOfDay AND date_end >= startOfDay (or date_end is null for ongoing)
    const filter = [
      {
        property: "date_start",
        value: endOfDay.toISOString(),
        operator: "lte",
        type: "date",
      },
      {
        property: "date_end",
        value: startOfDay.toISOString(),
        operator: "gte",
        type: "date",
      },
    ];

    const filterParam = encodeURIComponent(JSON.stringify(filter));
    const url = `${this.config.hortpro.baseUrl}/api/kids/${kidId}/presences?filter=${filterParam}&start=0&limit=9999`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...this.getHeaders(),
        Referer: `${this.config.hortpro.baseUrl}/K${kidId.substring(0, 8)}/presences`,
        Cookie: `selKidId=${kidId.substring(0, 8)}; sid-hep=${this.sidCookie}; did-hep=${this.didCookie}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch presences: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = (await response.json()) as PresencesResponse;
    if (!data.success) {
      throw new Error("API returned success: false");
    }
    return data.data?.rows || [];
  }
}
