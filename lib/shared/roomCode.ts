// Alphabet deliberately excludes visually ambiguous characters (0/O, 1/I/L)
// because the code is meant to be read aloud or typed from a text message.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((c) => CODE_ALPHABET.includes(c));
}
