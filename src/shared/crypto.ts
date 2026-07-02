export async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return base64urlFromBytes(await crypto.subtle.digest("SHA-256", data));
}

export function base64urlFromBytes(bytes: ArrayBuffer): string {
  let value = "";
  for (const byte of new Uint8Array(bytes)) {
    value += String.fromCharCode(byte);
  }
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
