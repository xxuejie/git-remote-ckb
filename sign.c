#include <stdio.h>
#include <secp256k1.h>
#include <secp256k1_recovery.h>

int char_to_int(char ch)
{
  if (ch >= '0' && ch <= '9') {
    return ch - '0';
  }
  if (ch >= 'a' && ch <= 'f') {
    return ch - 'a' + 10;
  }
  return -1;
}

int hex_to_bin(char* buf, size_t buf_len, const char* hex)
{
  int i = 0;

  for (; i < buf_len && hex[i * 2] != '\0' && hex[i * 2 + 1] != '\0'; i++) {
    int a = char_to_int(hex[i * 2]);
    int b = char_to_int(hex[i * 2 + 1]);

    if (a < 0 || b < 0) {
      return -1;
    }

    buf[i] = ((a & 0xF) << 4) | (b & 0xF);
  }

  if (i == buf_len && hex[i * 2] != '\0') {
    return -1;
  }
  return i;
}

// The address for this private key is ckt1qyqyxllaj6n0r9s4qdr722gx8uufgjz50rhsk65fqx
// Note this is for testing only! Please do not use it in production.
unsigned char* HARDCODED_PRIVATE_KEY = "0a031e3eceb7a152beb34c5323e1b74d7d8cb58a96f69cba7e6dd20ed9a26249";

int main(int argc, char* argv[]) {
  unsigned char private_key[32], message[32];
  if (argc < 2) {
    printf("Usage: %s <message to sign in hex with 0x>\n", argv[0]);
    return -100;
  }

  int ret = hex_to_bin((char*)private_key, 32, HARDCODED_PRIVATE_KEY);
  if (ret != 32) {
    return -101;
  }
  ret = hex_to_bin((char*)message, 32, argv[1] + 2);
  if (ret != 32) {
    return -102;
  }

  secp256k1_context *context = secp256k1_context_create(SECP256K1_CONTEXT_SIGN);
  if (context == NULL) {
    return -103;
  }

  secp256k1_ecdsa_recoverable_signature signature;
  ret = secp256k1_ecdsa_sign_recoverable(context, &signature, message, private_key, NULL, NULL);
  if (ret != 1) {
    secp256k1_context_destroy(context);
    return -104;
  }

  unsigned char output[64];
  int recid;
  ret = secp256k1_ecdsa_recoverable_signature_serialize_compact(context, output, &recid, &signature);
  if (ret != 1) {
    secp256k1_context_destroy(context);
    return -104;
  }

  printf("0x");
  for (int i = 0; i < 64; i++) {
    printf("%02x", output[i]);
  }
  printf("%02x\n", recid);

  return 0;
}
