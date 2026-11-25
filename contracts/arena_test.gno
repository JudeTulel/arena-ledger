package arena

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"gno.land/p/nt/avl/v0"
)

// TestEntrySplit verifies the exact economy split: 2 tokens in,
// 1.2 to the kill bounty and 0.8 to the community pool.
func TestEntrySplit(t *testing.T) {
	bounty, community := entrySplit()
	if bounty != 1200 {
		t.Fatalf("bounty: got %d want 1200 mtok", bounty)
	}
	if community != 800 {
		t.Fatalf("community share: got %d want 800 mtok", community)
	}
	if bounty+community != entryFee {
		t.Fatalf("split does not add up: %d + %d != %d", bounty, community, entryFee)
	}
	if entryFee != 2000 || baseBounty != 1200 || poolShare != 800 {
		t.Fatalf("unexpected economy constants: %d/%d/%d", entryFee, baseBounty, poolShare)
	}
	if boostBounty != 2*baseBounty {
		t.Fatalf("boost must double the bounty: got %d want %d", boostBounty, 2*baseBounty)
	}
	if boostBounty-baseBounty != baseBounty {
		t.Fatalf("boost top-up must equal one base bounty")
	}
}

// TestCanWithdraw verifies the credit-and-backing gate.
func TestCanWithdraw(t *testing.T) {
	if !canWithdraw(1200, 5000, 1200) {
		t.Fatal("valid withdraw should pass")
	}
	if canWithdraw(1200, 5000, 1201) {
		t.Fatal("withdraw above credit should fail")
	}
	if canWithdraw(5000, 1200, 1201) {
		t.Fatal("withdraw above backing should fail")
	}
	if canWithdraw(5000, 5000, 0) {
		t.Fatal("zero withdraw should fail")
	}
}

// TestFaucetCooldown verifies the 6-hour testnet grant gate.
func TestFaucetCooldown(t *testing.T) {
	if !canFaucet(0, 1000) {
		t.Fatal("a new player should be able to take a grant")
	}
	if canFaucet(1000, 1000+faucetCooldown-1) {
		t.Fatal("grant taken too soon should be refused")
	}
	if !canFaucet(1000, 1000+faucetCooldown) {
		t.Fatal("grant after the cooldown should be allowed")
	}
	if faucetAmount != 10000 || faucetCooldown != 21600 {
		t.Fatalf("unexpected faucet settings: %d/%d", faucetAmount, faucetCooldown)
	}
}

// TestFormatTokens checks the decimal strings the game client renders as
// "+1.2" and "+2.4".
func TestFormatTokens(t *testing.T) {
	cases := []struct {
		mtok int64
		want string
	}{
		{2000, "2"},
		{1200, "1.2"},
		{800, "0.8"},
		{2400, "2.4"},
		{100, "0.1"},
		{10, "0.01"},
		{1, "0.001"},
		{0, "0"},
		{-1200, "-1.2"},
	}
	for _, tc := range cases {
		if got := formatTokens(tc.mtok); got != tc.want {
			t.Fatalf("formatTokens(%d): got %q want %q", tc.mtok, got, tc.want)
		}
	}
}

// TestBoostedHours verifies the three documented UTC windows.
func TestBoostedHours(t *testing.T) {
	for _, h := range []int{6, 12, 18} {
		tm := time.Date(2026, 11, 24, h, 30, 0, 0, time.UTC)
		if !isBoosted(tm) {
			t.Fatalf("hour %d should be boosted", h)
		}
	}
	for _, h := range []int{0, 5, 7, 11, 13, 23} {
		tm := time.Date(2026, 11, 24, h, 30, 0, 0, time.UTC)
		if isBoosted(tm) {
			t.Fatalf("hour %d should not be boosted", h)
		}
	}
}

// TestBountyForKill checks the payout and how it is funded, in and out of
// a boosted window.
func TestBountyForKill(t *testing.T) {
	normal := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	payout, fromPool := bountyForKill(normal)
	if payout != 1200 || fromPool != 0 {
		t.Fatalf("normal kill: got (%d,%d) want (1200,0)", payout, fromPool)
	}

	boosted := time.Date(2026, 11, 24, 6, 0, 0, 0, time.UTC)
	payout, fromPool = bountyForKill(boosted)
	if payout != 2400 || fromPool != 1200 {
		t.Fatalf("boosted kill: got (%d,%d) want (2400,1200)", payout, fromPool)
	}
	if payout != 2*baseBounty {
		t.Fatalf("boosted payout is not double the base bounty")
	}
	if payout-fromPool != baseBounty {
		t.Fatalf("boosted kill must still take 1.2 from the victim")
	}
}

// TestLevelsAndMultiplier checks the 100/300/700 thresholds and the
// 100/110/120/130 percent XP multipliers.
func TestLevelsAndMultiplier(t *testing.T) {
	cases := []struct {
		xp   int64
		want int
	}{
		{0, 0}, {99, 0}, {100, 1}, {299, 1},
		{300, 2}, {699, 2}, {700, 3}, {5000, 3},
	}
	for _, tc := range cases {
		if got := levelForXP(tc.xp); got != tc.want {
			t.Fatalf("levelForXP(%d): got %d want %d", tc.xp, got, tc.want)
		}
	}

	p := &Player{}
	if got := awardXP(p, xpPerKill); got != 40 || p.XP != 40 {
		t.Fatalf("level-0 kill: got %d, xp %d", got, p.XP)
	}
	// Three level-0 kills reach 120 XP, which unlocks level 1.
	for i := 0; i < 2; i++ {
		awardXP(p, xpPerKill)
	}
	if p.XP != 120 || levelForXP(p.XP) != 1 {
		t.Fatalf("expected 120 XP / level 1, got %d / %d", p.XP, levelForXP(p.XP))
	}
	if got := awardXP(p, xpPerKill); got != 44 {
		t.Fatalf("level-1 kill: got %d want 44", got)
	}
	if got := awardXP(p, xpPerWin); got != 66 {
		t.Fatalf("level-1 win: got %d want 66", got)
	}

	p.XP = 300
	if got := awardXP(p, xpPerKill); got != 48 {
		t.Fatalf("level-2 kill: got %d want 48", got)
	}
	p.XP = 700
	if got := awardXP(p, xpPerKill); got != 52 {
		t.Fatalf("level-3 kill: got %d want 52", got)
	}
}

// TestBetterRanking checks XP, kills, wins and address tie-breakers.
func TestBetterRanking(t *testing.T) {
	hiXP := &Player{Addr: address("g1aaa"), XP: 700, Kills: 1}
	loXP := &Player{Addr: address("g1bbb"), XP: 300, Kills: 99}
	if !better(hiXP, loXP) || better(loXP, hiXP) {
		t.Fatalf("XP must rank first")
	}

	moreKills := &Player{Addr: address("g1bbb"), XP: 700, Kills: 10}
	fewerKills := &Player{Addr: address("g1aaa"), XP: 700, Kills: 9}
	if !better(moreKills, fewerKills) || better(fewerKills, moreKills) {
		t.Fatalf("kills must break an XP tie")
	}

	moreWins := &Player{Addr: address("g1bbb"), XP: 100, Kills: 5, Wins: 2}
	fewerWins := &Player{Addr: address("g1aaa"), XP: 100, Kills: 5, Wins: 1}
	if !better(moreWins, fewerWins) || better(fewerWins, moreWins) {
		t.Fatalf("wins must break an XP/kills tie")
	}

	lowAddr := &Player{Addr: address("g1aaa"), XP: 100, Kills: 5, Wins: 2}
	highAddr := &Player{Addr: address("g1zzz"), XP: 100, Kills: 5, Wins: 2}
	if !better(lowAddr, highAddr) || better(highAddr, lowAddr) {
		t.Fatalf("address must break a full tie")
	}
	if better(lowAddr, lowAddr) {
		t.Fatalf("better must be strict")
	}
}

// TestTopLeaderboard checks that Top returns at most ten players in the
// order defined by better.
func TestTopLeaderboard(t *testing.T) {
	players = avl.NewTree()
	for i := 0; i < 12; i++ {
		a := address("g1player" + strconv.Itoa(i))
		players.Set(a.String(), &Player{Addr: a, XP: int64(i * 10)})
	}
	top := Top()
	if len(top) != 10 {
		t.Fatalf("Top length: got %d want 10", len(top))
	}
	if top[0].XP != 110 {
		t.Fatalf("Top[0] XP: got %d want 110", top[0].XP)
	}
	for i := 1; i < len(top); i++ {
		if better(top[i], top[i-1]) {
			t.Fatalf("leaderboard out of order at %d", i)
		}
	}
}

// TestRenderSmoke checks that the rendered page includes the economy,
// forms for every public crossing function, and a sanitized leaderboard.
func TestRenderSmoke(t *testing.T) {
	page := Render("")
	for _, want := range []string{
		"Arena Ledger", "1.2", "0.8", "2.4", "06:00", "12:00", "18:00",
		"exec=\"Enter\"", "exec=\"ReportKill\"", "exec=\"ReportWin\"",
		"exec=\"Claim\"", "Leaderboard",
	} {
		if !strings.Contains(page, want) {
			t.Fatalf("Render is missing %q", want)
		}
	}
}
