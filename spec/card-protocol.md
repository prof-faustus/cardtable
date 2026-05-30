# Spec: Card Protocol

> **Status:** authoritative for the **commitment-based MVP** (Phase 5
> In-Between). The **extended one-UTXO-per-card model** is sketched
> here for Phase 4+ alignment but is not the v1 normative protocol.
> Aligns with Formal Architecture §2.8 (Card representation) and §9
> (Cryptographic Layer).

## 1. Two models

**Commitment-based deck (MVP, In-Between v1).** The deck is a single
committed shuffled ordering over the 52 (or 54) canonical card indices.
Positions are opened publicly by `CardReveal` transactions. There is
no concealed private hand; In-Between exposes all three cards of a
round.

**One UTXO per card (extended model, Phase 4+).** Each card is a unique
tokenised UTXO with a face commitment and an encrypted payload deliverable
only to the holder. Used for games with concealed private hands.

This document specifies both, with the MVP rules called out as the v1
normative path.

## 2. Canonical deck definition

The canonical deck is the ordered list of 52 cards in the suits order
`{ clubs, diamonds, hearts, spades }` and ranks `{ 2, 3, 4, 5, 6, 7, 8,
9, 10, J, Q, K, A }`. The cardinal index of a card is
`13 * suit_index + rank_index`, with `suit_index` and `rank_index`
zero-based. Card `0` is the 2 of clubs; card `51` is the ace of spades.
The 54-card variant (with two jokers) is `card 52 = joker_black`,
`card 53 = joker_red`; In-Between v1 uses the 52-card variant unless the
`RuleSet.deck_format` field specifies 54.

## 3. Combined entropy and shuffle

Each seated player `i` generates `entropy_i`, an opaque 32-byte string,
and broadcasts `H(entropy_i || playerId_i || gameId)` in
`TXC_ENTROPY_COMMIT`. After every player has committed, each player
broadcasts `entropy_i` in `TXC_ENTROPY_REVEAL`. The state engine
verifies that the revealed plaintext hashes back to the commitment.

The combined entropy is then computed as

```
combined = SHA-256( type_tag(0x0007) || encode_array(entropy_1, ..., entropy_n) )
```

where the entropies are ordered by ascending seat index (canonical per
`spec/serialisation.md` §3).

The shuffle is **Fisher-Yates** over the canonical deck using a
deterministic SHA-256-counter-mode byte stream seeded by `combined`
(per [ADR-001](../docs/adr/001-sha256-counter-prg-for-shuffle.md)).
For positions `i = n_cards - 1, ..., 1`, the algorithm draws an
integer `j` uniformly in `[0, i]` from the stream (four bytes
little-endian, rejection-sampled to remove modulo bias) and swaps
positions `i` and `j` of the working deck. The shuffle algorithm
version is recorded in `DeckCommitment.shuffle_algorithm_version`;
v1 = `1`.

A reference implementation is required to match the test vector
`spec/test-vectors/mental-poker.json` byte-for-byte: the Go reference
`apps/relay-go/pkg/cryptocards` and the TypeScript reference
`packages/crypto-cards` are pinned to the same hex outputs via their
`TestCrossLanguageConformance` blocks.

## 4. Deck commitment

After shuffling, the deck commitment is

```
deck_commitment = SHA-256( type_tag(0x0007) || encode_u8(shuffle_alg_version) || encode_array(card_commitment[0], ..., card_commitment[51]) )
```

where each `card_commitment[i]` is the commitment to position `i` of
the shuffled deck.

- **MVP card commitment:** `card_commitment[i] = SHA-256( type_tag(0x0008) || encode_u8(shuffled_deck[i]) || encode_bytes32(card_nonce_i) || encode_bytes32(deck_nonce) )`. The `card_nonce_i` and `deck_nonce` are per-position random values fixed at deck-commit time, included in the `DeckCommitment` object's `hidden_card_commitments` field.

- **Extended card commitment:** identical structure, with the
  additional property that each card_commitment becomes the locking
  scriptcondition of a card-custody UTXO.

`TXC_DECK_COMMIT` anchors `deck_commitment` on-chain.

## 5. Card reveal (MVP)

`TXC_CARD_REVEAL` opens position `i` of the shuffled deck. The
unlocking script provides `(shuffled_deck[i], card_nonce_i)`; the
script verifies `SHA-256(...) == card_commitment[i]` (via
`OP_HASH256 <expected> OP_EQUALVERIFY` in the round-state output's
script-templates §2.7 successor template).

The `OP_RETURN` metadata of the reveal transaction also carries the
revealed plaintext for off-chain audit.

A `CardReveal` whose preimage does not match the commitment is
**invalid** at the script layer; the BSV interpreter rejects it before
it can pollute mempool state.

## 6. Card reveal (extended, Phase 4+)

In the extended model, each card UTXO carries an encrypted payload
addressable to the holder's `card_encryption_pubkey`. The reveal
procedure has two routes:

- **Public reveal (showdown):** as in MVP — preimage matches commitment,
  plaintext anchored in metadata.
- **Local reveal (concealed):** the holder decrypts the payload
  privately; no on-chain reveal occurs. At fold time, the
  `TXC_FOLD` surrender preserves encryption.

Encryption is via a layered protocol (mental-poker-style); the exact
construction and its security proof are open proof obligations
(PROJECT_SPEC.md §Open Proof Obligations item 1). Phase 4+ work.

## 7. Fold without reveal (extended)

A fold transaction MUST:

1. Prove the player controls the concealed hand objects (their
   signature on the `card-custody` cooperative branch).
2. Transfer them to dead-hand surrender state (`fold-surrender`
   template).
3. Preserve all encryption layers (no on-chain plaintext).
4. Remove the player from live contention (the surrendered cards
   cannot re-enter play).

A fold MUST NOT:

1. Reveal any card face.
2. Leak any information about card identity (including via partial
   ciphertext patterns).
3. Require cooperation from other players.

The MVP (In-Between v1) does not need fold; In-Between has no concealed
hand.

## 8. Non-reveal and recovery

If a participant withholds an entropy reveal:

- The relevant entropy-commitment output's **cooperative-fallback
  branch** becomes spendable once the input's relative-locktime delta
  matures (the pre-signed advance-without-this-player tx carries the
  delta on its input `nSequence`).
- The cooperative-fallback path inside the timeout branch
  (`m-of-(n-1)` of the other players) allows the remaining quorum to
  continue without the non-revealer's entropy. The non-revealer is
  penalised per `RuleSet.penalty_schedule.non_reveal`.

If a participant withholds a card reveal at showdown (extended model):

- The card-custody output's reveal branch is not satisfied; the
  cooperative fold-surrender branch may be triggered by the holder if
  they prefer to fold rather than reveal a losing hand. If the holder
  is silent through both reveal and fold deadlines, the recovery
  branch eventually returns custody to the original funder via the
  pre-signed recovery refund tx whose `nLockTime = recovery_height`.

## 9. Conformance

A card-protocol implementation conforms to this spec iff:

1. Given an ordered set of entropies, it produces the exact
   `combined` and `shuffled_deck` of the test vectors.
2. Given a `DeckCommitment` and a position, its `revealCard` returns
   the same `(plaintext, proof)` as the test vectors.
3. `verifyCardReveal` rejects every malformed reveal in the test
   vectors with the listed error code.
4. The extended model (Phase 4+) additionally preserves encryption
   through fold and recovery as specified in §7 and §8.
