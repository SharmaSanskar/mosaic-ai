package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// Secrets (user-supplied provider API keys) are encrypted at rest with
// AES-256-GCM under a single master key from the ENCRYPTION_KEY env var. The
// ciphertext and nonce are stored base64-encoded as text so they travel cleanly
// over PostgREST. The plaintext key is only ever held in memory on the backend,
// just long enough to make a provider call — it is never returned to any client.

func masterKey(masterB64 string) ([]byte, error) {
	if masterB64 == "" {
		return nil, fmt.Errorf("ENCRYPTION_KEY is not configured")
	}
	key, err := base64.StdEncoding.DecodeString(masterB64)
	if err != nil {
		return nil, fmt.Errorf("ENCRYPTION_KEY is not valid base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("ENCRYPTION_KEY must decode to 32 bytes (got %d)", len(key))
	}
	return key, nil
}

// encryptSecret returns base64(ciphertext) and base64(nonce).
func encryptSecret(masterB64, plaintext string) (ciphertextB64, nonceB64 string, err error) {
	key, err := masterKey(masterB64)
	if err != nil {
		return "", "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext),
		base64.StdEncoding.EncodeToString(nonce), nil
}

// decryptSecret reverses encryptSecret.
func decryptSecret(masterB64, ciphertextB64, nonceB64 string) (string, error) {
	key, err := masterKey(masterB64)
	if err != nil {
		return "", err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", fmt.Errorf("invalid ciphertext encoding: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(nonceB64)
	if err != nil {
		return "", fmt.Errorf("invalid nonce encoding: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(nonce) != gcm.NonceSize() {
		return "", fmt.Errorf("nonce size mismatch")
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}
	return string(plaintext), nil
}

// last4 returns the last 4 characters of a key for display, without revealing
// the rest. Short keys are fully masked.
func last4(s string) string {
	if len(s) < 8 {
		return "****"
	}
	return s[len(s)-4:]
}
