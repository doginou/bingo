import type { SupabaseClient } from "@supabase/supabase-js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomRoomCode(length = 6): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!;
  }
  return s;
}

export async function createUniqueRoomCode(
  supabase: SupabaseClient,
  maxAttempts = 12,
): Promise<string> {
  for (let a = 0; a < maxAttempts; a++) {
    const code = randomRoomCode();
    const { data } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Impossible de générer un code unique.");
}
