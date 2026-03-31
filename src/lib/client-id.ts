export function getClientId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem("bingo_client_id");
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem("bingo_client_id", id);
  }
  return id;
}

export function roomPlayerStorageKey(roomCode: string): string {
  return `bingo_player_id_${roomCode}`;
}

export function getStoredPlayerId(roomCode: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(roomPlayerStorageKey(roomCode));
}

export function setStoredPlayerId(roomCode: string, playerId: string): void {
  window.localStorage.setItem(roomPlayerStorageKey(roomCode), playerId);
}

export function clearStoredPlayerId(roomCode: string): void {
  window.localStorage.removeItem(roomPlayerStorageKey(roomCode));
}
