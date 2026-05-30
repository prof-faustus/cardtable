# Test Vectors

Canonical inputs/outputs for the In-Between state engine and supporting
modules. Every vector is a JSON document with a documented shape:

```jsonc
{
  "vector_id": "kebab-case-id",
  "description": "one-sentence what this vector tests",
  "rule_set": { /* RuleSet object, JSON-debug form */ },
  "initial_state": { /* RoundState or null for fresh game */ },
  "inputs": [
    { "kind": "Action" | "TimeoutTick" | "Reveal" | "...", ... }
  ],
  "expected_result": "ok" | "error",
  "expected_state": { /* RoundState; required when expected_result == ok */ },
  "expected_error": "ERROR_CODE",
  "expected_emitted_txs": [
    { "class": "TXC_...", "binding": { ... }, "outputs": [ ... ] }
  ],
  "notes": "free-text rationale"
}
```

The JSON form here is the **debug** form (per `spec/serialisation.md`
§7). Implementations must:

1. Parse this JSON into protocol-types objects.
2. Run the state engine.
3. Compare the resulting state's **canonical binary encoding** to the
   canonical binary encoding of `expected_state` (not the JSON form).

Cross-implementation equivalence is asserted on the canonical binary
form, not on the JSON.

## Vectors

| File | What it tests |
|---|---|
| `valid-join.json` | A well-formed `Join` is accepted; player-stake output appears |
| `invalid-join.json` | A `Join` with wrong stake amount is rejected with `INVALID_STAKE_AMOUNT` |
| `fold.json` | (Reserved for Phase 4+ extended model) Fold preserves encryption |
| `timeout-refund.json` | `BET_DECISION` silence past deadline produces `Pass` default; pot unchanged |
| `settlement.json` | `Settle` distributes pot per `RuleSet.settlement_rules` for In-Between win/loss/penalty |
| `double-spend-attempt.json` | Two `BetAction` txs for the same state; deterministic resolution per `spec/ordering-rules.md` §3 |
| `reveal-proof.json` | A `CardReveal` with valid preimage + commitment is accepted; one with wrong preimage is rejected |
| `recovery.json` | Recovery after global timeout refunds seated stakes per `recovery_rules` |
