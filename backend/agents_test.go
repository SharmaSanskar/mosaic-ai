package main

import (
	"reflect"
	"testing"
)

func TestParseMentions(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"hey @researcher what do you think?", []string{"researcher"}},
		{"@Researcher @CRITIC compare these", []string{"researcher", "critic"}},
		{"@ai summarize", []string{"ai"}},
		{"no mentions here", nil},
		{"dup @ai and @ai again", []string{"ai"}},
		{"email a@b.com is not a mention of b", []string{"b"}},
	}
	for _, c := range cases {
		got := parseMentions(c.in)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseMentions(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestIsAIAuthor(t *testing.T) {
	if !isAIAuthor("AI") {
		t.Error(`"AI" should be an AI author`)
	}
	if !isAIAuthor("agent:abc-123") {
		t.Error(`"agent:..." should be an AI author`)
	}
	if isAIAuthor("8f2c1a90-0000-0000-0000-000000000000") {
		t.Error("a human UUID should not be an AI author")
	}
}

func TestAgentAuthorIDRoundTrip(t *testing.T) {
	a := Agent{ID: "abc-123"}
	author := agentAuthorID(a)
	if author != "agent:abc-123" {
		t.Fatalf("agentAuthorID = %q", author)
	}
	if !isAIAuthor(author) {
		t.Fatal("agentAuthorID output should be recognized as AI author")
	}
}
