import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppState, UserRegistration, UserState } from "./types.js";

const STATE_FILE = "./data/state.json";

export async function loadState(): Promise<AppState> {
  try {
    const data = await readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(data) as AppState;
    // Ensure linkKeys exists for backwards compatibility
    if (!state.linkKeys) {
      state.linkKeys = {};
    }
    return state;
  } catch {
    return {
      users: {},
      userStates: {},
      linkKeys: {},
    };
  }
}

export async function saveState(state: AppState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function getUser(state: AppState, chatId: number): UserRegistration | undefined {
  return state.users[String(chatId)];
}

export function setUser(state: AppState, chatId: number, user: UserRegistration): void {
  state.users[String(chatId)] = user;
  state.linkKeys[user.linkKey] = String(chatId);
}

export function removeUser(state: AppState, chatId: number): void {
  const user = state.users[String(chatId)];
  if (user?.linkKey) {
    delete state.linkKeys[user.linkKey];
  }
  delete state.users[String(chatId)];
  delete state.userStates[String(chatId)];
}

export function getUserByNotifyChatId(state: AppState, notifyChatId: number): UserRegistration | undefined {
  // Find user whose notifications go to this chat
  return Object.values(state.users).find((u) => u.notifyChatId === notifyChatId);
}

export function getUserByLinkKey(state: AppState, linkKey: string): UserRegistration | undefined {
  const chatId = state.linkKeys[linkKey];
  if (!chatId) return undefined;
  return state.users[chatId];
}

export function generateLinkKey(): string {
  // Generate a short random key (6 chars)
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function getUserState(state: AppState, chatId: number): UserState {
  const key = String(chatId);
  if (!state.userStates[key]) {
    state.userStates[key] = {
      notifiedPresences: {},
      completedKids: {},
      lastCheck: new Date().toISOString(),
    };
  }
  // Ensure completedKids exists for backwards compatibility
  if (!state.userStates[key].completedKids) {
    state.userStates[key].completedKids = {};
  }
  return state.userStates[key];
}

export function isArrivalNotified(userState: UserState, presenceId: string): boolean {
  return userState.notifiedPresences[presenceId]?.arrival === true;
}

export function isDepartureNotified(userState: UserState, presenceId: string): boolean {
  return userState.notifiedPresences[presenceId]?.departure === true;
}

export function markArrivalNotified(userState: UserState, presenceId: string): void {
  if (!userState.notifiedPresences[presenceId]) {
    userState.notifiedPresences[presenceId] = {};
  }
  userState.notifiedPresences[presenceId].arrival = true;
}

export function markDepartureNotified(userState: UserState, presenceId: string): void {
  if (!userState.notifiedPresences[presenceId]) {
    userState.notifiedPresences[presenceId] = {};
  }
  userState.notifiedPresences[presenceId].departure = true;
}

export function isKidCompletedToday(userState: UserState, kidId: string): boolean {
  return userState.completedKids[kidId] === true;
}

export function markKidCompleted(userState: UserState, kidId: string): void {
  userState.completedKids[kidId] = true;
}

export function cleanupOldState(userState: UserState): void {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  if (userState.lastCheck < todayStart) {
    userState.notifiedPresences = {};
    userState.completedKids = {};
  }
  userState.lastCheck = now.toISOString();
}
