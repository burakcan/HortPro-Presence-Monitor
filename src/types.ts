export interface Institution {
  id: number;
  title: string;
  city: string;
  zipcode: string;
  street: string;
  [key: string]: unknown;
}

export interface Kid {
  id: string;
  first_name: string;
  last_name: string;
  institution: Institution;
  kid_group: string;
  [key: string]: unknown;
}

export interface Presence {
  id: string;
  date_start: string;
  date_end: string | null;
  duration: number | null;
}

export interface KidsResponse {
  success: boolean;
  data: Kid[];
}

export interface PresencesResponse {
  success: boolean;
  data: {
    count: number;
    rows: Presence[];
  };
}

export interface UserRegistration {
  chatId: number;
  sidCookie: string;
  didCookie: string;
  kids: Kid[];
  registeredAt: string;
  linkKey: string; // Key to link group chats
  notifyChatId: number; // Where to send notifications (can be group)
}

export interface NotifiedPresence {
  arrival?: boolean;
  departure?: boolean;
}

export interface UserState {
  notifiedPresences: Record<string, NotifiedPresence>;
  completedKids: Record<string, boolean>; // kidId -> true if departed today
  lastCheck: string;
}

export interface AppState {
  users: Record<string, UserRegistration>; // keyed by chatId
  userStates: Record<string, UserState>; // keyed by chatId
  linkKeys: Record<string, string>; // linkKey -> chatId mapping
}
