package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"
)

type jwk struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Kid string `json:"kid"`
}

type jwksResponse struct {
	Keys []jwk `json:"keys"`
}

// JWKSCache fetches and caches Supabase's JWT signing keys, used to verify
// ES256-signed access tokens. Supabase's newer default is asymmetric signing
// keys (fetched here) rather than the legacy shared HS256 secret.
type JWKSCache struct {
	mu     sync.Mutex
	url    string
	client *http.Client
	keys   map[string]*ecdsa.PublicKey
}

func NewJWKSCache(supabaseURL string) *JWKSCache {
	return &JWKSCache{
		url:    supabaseURL + "/auth/v1/.well-known/jwks.json",
		client: &http.Client{Timeout: 5 * time.Second},
		keys:   make(map[string]*ecdsa.PublicKey),
	}
}

func (c *JWKSCache) refresh() error {
	resp, err := c.client.Get(c.url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks fetch failed: status %d", resp.StatusCode)
	}

	var parsed jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return err
	}

	keys := make(map[string]*ecdsa.PublicKey, len(parsed.Keys))
	for _, k := range parsed.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" {
			continue
		}
		pub, err := decodeECPublicKey(k.X, k.Y)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}

	c.mu.Lock()
	c.keys = keys
	c.mu.Unlock()
	return nil
}

// Key returns the public key for kid, refreshing the cache once if it's
// not already known (handles key rotation without a restart).
func (c *JWKSCache) Key(kid string) (*ecdsa.PublicKey, error) {
	c.mu.Lock()
	key, ok := c.keys[kid]
	c.mu.Unlock()
	if ok {
		return key, nil
	}

	if err := c.refresh(); err != nil {
		return nil, err
	}

	c.mu.Lock()
	key, ok = c.keys[kid]
	c.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown signing key: %s", kid)
	}
	return key, nil
}

func decodeECPublicKey(xB64, yB64 string) (*ecdsa.PublicKey, error) {
	xBytes, err := base64.RawURLEncoding.DecodeString(xB64)
	if err != nil {
		return nil, err
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(yB64)
	if err != nil {
		return nil, err
	}
	return &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(xBytes),
		Y:     new(big.Int).SetBytes(yBytes),
	}, nil
}
