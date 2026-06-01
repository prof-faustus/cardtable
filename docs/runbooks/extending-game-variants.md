# Extending cardtable for new game variants

The cardtable protocol's core state machine is purpose-built for
In-Between (Acey-Deucey). Two extension surfaces let game variants
add their own semantics without forking the engine:

## 1. Extending the card lifecycle

`CardLifecycleState` is a string union with five **canonical** values
every reference engine honours:

```
UNDEALT  ASSIGNED_CONCEALED  REVEALED  SURRENDERED  RETIRED
```

The union also accepts `(string & {})` (TS) / arbitrary `string` (Go),
so a variant can introduce its own states — `MUCKED`, `BURNT`, `BOARD`,
`COMMUNITY`, etc. — without modifying any engine code. The `Fold`
handler only transitions cards from `ASSIGNED_CONCEALED` to
`SURRENDERED`; variant-specific states are preserved verbatim.

To validate at runtime that a variant uses only the canonical set,
consult `CANONICAL_LIFECYCLE_STATES` (TS) /
`CanonicalLifecycleStates` (Go).

## 2. Adding actions / state-class transitions

The engine's `applyAction` is a pure switch on `ActionType`. New
actions land via three steps:

1. **Define the action shape** in
   `packages/protocol-types/src/actions.ts` (TS-only — the Go side
   collapses everything into one struct):

   ```ts
   export interface MuckAction extends SignedActionBase {
     readonly action_type: 'Muck';
     readonly position: number;
   }
   ```

   Add to the `ActionType` union and `SignedAction` discriminated
   union. Mirror the new `ActionType` constant + any required
   variant-specific field on `apps/relay-go/pkg/types/SignedAction`.

2. **Update `getLegalActions(state_class)`** to advertise the new
   action where it's legal. Mirror in
   `apps/relay-go/pkg/engine/GetLegalActions`.

3. **Add the handler**: `applyMuck(state, action, ruleSet)`. Return
   `Result<RoundState, ProtocolError>`. Mirror in
   `apps/relay-go/pkg/engine/applyMuck`. Both implementations must
   agree byte-for-byte on every transition — the cross-language
   conformance tests enforce this for the existing actions.

## 3. Dealing a concealed deck

For game variants with concealed hands (poker, blackjack with hole
cards, etc.) the orchestrator submits a `DealConcealed` action at
`S5_DECK_COMMITTED`:

```ts
import { encryptForHolder } from '@cardtable/crypto-cards';

const concealed = await Promise.all(
  shuffledDeck.map(async (ordinal, position) => {
    const payload = packReveal(ordinal, cardNonce, deckNonce);
    const envelope = await encryptForHolder(payload, holderPubkey);
    return {
      card_commitment: { position, card_commitment: ..., card_nonce: ... },
      ciphertext: encodeBase64(envelope.ciphertext), // include iv + ephemeralPubkey
      custody_outpoint,
      holder_pubkey: holderPubkey,
      lifecycle_state: 'ASSIGNED_CONCEALED',
    };
  }),
);

await relay.sendAction({
  action_type: 'DealConcealed',
  concealed_cards: concealed,
  ...
});
```

The engine validates:

- count matches `ruleSet.deck_format` (52 or 54)
- positions are `0..deck_format-1` with no duplicates
- no concealed deck has already been dealt for this round (idempotency)

On success, `state.concealed_deck` is populated and `Fold` becomes
reachable. The relay never decrypts the ciphertexts — they pass
through opaquely.

## 4. Holder-only reveal

A holder reads their card by decrypting the envelope locally:

```ts
import { decryptForHolder } from '@cardtable/crypto-cards';

const opened = await decryptForHolder(envelope, holderPrivKey);
const { ordinal, cardNonce, deckNonce } = unpackReveal(opened);
```

If the holder later wants to **show** the card, they submit a normal
`CardReveal` action with the reveal proof — the engine verifies the
commitment as it does in the MVP path. If the holder folds without
revealing, the engine transitions the card to `SURRENDERED` without
ever seeing the ordinal.

## 5. Tests as variant documentation

The named adversarial scenarios at
`packages/state-engine/__tests__/adversarial-scenarios.test.ts` and
`apps/relay-go/internal/session/adversarial_test.go` use the
`A##` numbering convention. When a variant adds a new protection
property, add the corresponding `A##` case so the protection surface
stays visible in one file per side.
