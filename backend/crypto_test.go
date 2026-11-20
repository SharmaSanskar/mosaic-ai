package main

import (
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func newMasterKey(t *testing.T) string {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return base64.StdEncoding.EncodeToString(key)
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	master := newMasterKey(t)
	plaintext := "sk-ant-api03-super-secret-value-9876543210"

	ct, nonce, err := encryptSecret(master, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if ct == "" || nonce == "" {
		t.Fatal("expected non-empty ciphertext and nonce")
	}
	if ct == plaintext {
		t.Fatal("ciphertext must not equal plaintext")
	}

	got, err := decryptSecret(master, ct, nonce)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plaintext {
		t.Fatalf("round trip mismatch: got %q want %q", got, plaintext)
	}
}

func TestEncryptIsNondeterministic(t *testing.T) {
	master := newMasterKey(t)
	ct1, _, _ := encryptSecret(master, "same-input")
	ct2, _, _ := encryptSecret(master, "same-input")
	if ct1 == ct2 {
		t.Fatal("expected different ciphertexts due to random nonce")
	}
}

func TestDecryptWithWrongKeyFails(t *testing.T) {
	master := newMasterKey(t)
	other := newMasterKey(t)
	ct, nonce, _ := encryptSecret(master, "secret")
	if _, err := decryptSecret(other, ct, nonce); err == nil {
		t.Fatal("expected decryption with a different key to fail")
	}
}

func TestDecryptTamperedCiphertextFails(t *testing.T) {
	master := newMasterKey(t)
	ct, nonce, _ := encryptSecret(master, "secret")
	raw, _ := base64.StdEncoding.DecodeString(ct)
	raw[0] ^= 0xff // flip a bit
	tampered := base64.StdEncoding.EncodeToString(raw)
	if _, err := decryptSecret(master, tampered, nonce); err == nil {
		t.Fatal("expected GCM auth to reject tampered ciphertext")
	}
}

func TestMasterKeyValidation(t *testing.T) {
	if _, err := masterKey(""); err == nil {
		t.Fatal("empty key should error")
	}
	if _, err := masterKey("not-base64!!!"); err == nil {
		t.Fatal("invalid base64 should error")
	}
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	if _, err := masterKey(short); err == nil {
		t.Fatal("16-byte key should error (need 32)")
	}
}

func TestLast4(t *testing.T) {
	if got := last4("sk-abcdefgh"); got != "efgh" {
		t.Fatalf("last4 = %q want efgh", got)
	}
	if got := last4("short"); got != "****" {
		t.Fatalf("last4 of short key = %q want ****", got)
	}
}
