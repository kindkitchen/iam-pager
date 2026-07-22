import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { encode_base64url } from "../base64url.ts";
import {
  AesGcmStorageCredentialCipher,
  STORAGE_TOKEN_KEY_ENV,
} from "./token-cipher.ts";

const credentials = {
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  access_token_expires_at: new Date("2026-07-22T12:00:00.000Z"),
};

Deno.test("AES-GCM storage credential cipher round-trips with randomized ciphertext", async () => {
  const cipher = await AesGcmStorageCredentialCipher.from_key_bytes(
    new Uint8Array(32).fill(7),
  );
  const first = await cipher.encrypt("connection-1", credentials);
  const second = await cipher.encrypt("connection-1", credentials);
  assertNotEquals(first.iv, second.iv);
  assertNotEquals(first.ciphertext, second.ciphertext);
  assertEquals(await cipher.decrypt("connection-1", first), credentials);
  assertEquals(await cipher.decrypt("connection-1", second), credentials);
  assertEquals(
    new TextDecoder().decode(first.ciphertext).includes("access-secret"),
    false,
  );
});

Deno.test("AES-GCM storage credential cipher binds ciphertext to key and connection", async () => {
  const cipher = await AesGcmStorageCredentialCipher.from_key_bytes(
    new Uint8Array(32).fill(1),
  );
  const other = await AesGcmStorageCredentialCipher.from_key_bytes(
    new Uint8Array(32).fill(2),
  );
  const encrypted = await cipher.encrypt("connection-1", credentials);
  await assertRejects(
    async () => await cipher.decrypt("connection-2", encrypted),
    TypeError,
    "invalid encrypted storage credentials",
  );
  await assertRejects(
    async () => await other.decrypt("connection-1", encrypted),
    TypeError,
    "invalid encrypted storage credentials",
  );

  encrypted.ciphertext[0] ^= 0xff;
  await assertRejects(
    async () => await cipher.decrypt("connection-1", encrypted),
    TypeError,
    "invalid encrypted storage credentials",
  );
});

Deno.test("storage credential key configuration requires canonical 256-bit base64url", async () => {
  const encoded = encode_base64url(new Uint8Array(32).fill(9));
  const cipher = await AesGcmStorageCredentialCipher.from_base64url_key(
    encoded,
  );
  const encrypted = await cipher.encrypt("connection-1", credentials);
  assertEquals(await cipher.decrypt("connection-1", encrypted), credentials);

  await assertRejects(
    async () =>
      await AesGcmStorageCredentialCipher.from_base64url_key("not-a-key"),
    TypeError,
    STORAGE_TOKEN_KEY_ENV,
  );
  await assertRejects(
    async () =>
      await AesGcmStorageCredentialCipher.from_key_bytes(new Uint8Array(31)),
    TypeError,
    "32 bytes",
  );
});
