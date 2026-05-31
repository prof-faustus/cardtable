/**
 * Open-information prototype UI shell.
 *
 * One operator drives an entire In-Between table through the engine
 * to demonstrate the state machine end-to-end. Phase 3c.2 will
 * replace this single-process driver with one WebSocket per player.
 */

import { asSeat } from '@cardtable/protocol-types';
import { useTableStore } from './store.js';

export function App(): JSX.Element {
  const state = useTableStore((s) => s.state);
  const ruleSet = useTableStore((s) => s.ruleSet);
  const lastError = useTableStore((s) => s.lastError);
  const settlement = useTableStore((s) => s.settlement);

  const connection = useTableStore((s) => s.connection);
  const relayUrl = useTableStore((s) => s.relayUrl);
  const connect = useTableStore((s) => s.connect);
  const disconnect = useTableStore((s) => s.disconnect);

  const seatJoin = useTableStore((s) => s.seatJoin);
  const tableLock = useTableStore((s) => s.tableLock);
  const entropyCommit = useTableStore((s) => s.entropyCommit);
  const entropyReveal = useTableStore((s) => s.entropyReveal);
  const revealCard = useTableStore((s) => s.revealCard);
  const placeBet = useTableStore((s) => s.placeBet);
  const pass = useTableStore((s) => s.pass);
  const settle = useTableStore((s) => s.settle);
  const reset = useTableStore((s) => s.reset);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>cardtable — In-Between (open information)</h1>

      <section style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#eef' }}>
        <strong>Connection:</strong> <code data-testid="connection-mode">{connection}</code>
        {relayUrl && <> @ <code>{relayUrl}</code></>}{' '}
        <button onClick={() => void connect('ws://localhost:8081/ws')} disabled={connection === 'online' || connection === 'connecting'}>
          Connect to relay
        </button>{' '}
        <button onClick={disconnect} disabled={connection === 'offline'}>
          Disconnect (offline mode)
        </button>
      </section>

      <p style={{ color: '#555' }}>
        Phase 3c.1 reference UI. State class:{' '}
        <code data-testid="state-class">{state.state_class}</code>; pot:{' '}
        <code data-testid="pot">{state.pot_value}</code>; players:{' '}
        <code data-testid="seat-count">{state.players.length}</code>;
        round: <code>{state.round_number}</code>; acting seat:{' '}
        <code data-testid="acting-seat">{String(state.acting_player_seat)}</code>.
      </p>

      <section style={{ marginTop: '1rem' }}>
        <h2>Seats</h2>
        <ul>
          {state.players.map((p) => (
            <li key={p.seat}>
              seat <strong>{p.seat}</strong> — status <em>{p.participation_status}</em> —
              stake_at_risk <code>{p.stake_at_risk}</code>
            </li>
          ))}
        </ul>
        <button onClick={() => seatJoin(asSeat(0))}>Seat seat 0</button>{' '}
        <button onClick={() => seatJoin(asSeat(1))}>Seat seat 1</button>{' '}
        <button onClick={tableLock}>Lock table</button>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Deck commitments</h2>
        <button onClick={() => entropyCommit(asSeat(0))}>Commit seat 0</button>{' '}
        <button onClick={() => entropyCommit(asSeat(1))}>Commit seat 1</button>{' '}
        <button onClick={() => entropyReveal(asSeat(0))}>Reveal seat 0</button>{' '}
        <button onClick={() => entropyReveal(asSeat(1))}>Reveal seat 1</button>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Cards revealed: {state.visible_cards.length}</h2>
        <ul data-testid="visible-cards">
          {state.visible_cards.map((c, i) => (
            <li key={i}>
              {c.rank} of {c.suit} (ordinal {c.ordinal})
            </li>
          ))}
        </ul>
        <button onClick={() => revealCard(3)}>Reveal card ordinal 3</button>{' '}
        <button onClick={() => revealCard(20)}>Reveal card ordinal 20</button>{' '}
        <button onClick={() => revealCard(5)}>Reveal card ordinal 5 (winning third)</button>{' '}
        <button onClick={() => revealCard(11)}>Reveal card ordinal 11 (losing third)</button>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <h2>Bet decision</h2>
        <button onClick={() => placeBet(ruleSet.min_bet)}>Bet min ({ruleSet.min_bet})</button>{' '}
        <button onClick={() => placeBet(ruleSet.max_bet)}>Bet max ({ruleSet.max_bet})</button>{' '}
        <button onClick={pass}>Pass</button>{' '}
        <button onClick={() => settle(state.acting_player_seat ?? asSeat(0))}>Settle round</button>
      </section>

      {settlement && (
        <section style={{ marginTop: '1rem', padding: '0.75rem', background: '#f4f4f4' }}>
          <h2>Settlement</h2>
          <p>
            Outcome: <strong data-testid="settlement-outcome">{settlement.outcome}</strong>; bet{' '}
            <code>{settlement.bet_amount}</code>; amount won/lost{' '}
            <code>{settlement.amount_won_or_lost}</code>; resulting pot{' '}
            <code>{settlement.resulting_pot_value}</code>.
          </p>
        </section>
      )}

      {lastError && (
        <section style={{ marginTop: '1rem', padding: '0.75rem', background: '#fee2e2' }}>
          <strong>Last engine error:</strong> <code>{lastError.code}</code> — {lastError.context}
        </section>
      )}

      <footer style={{ marginTop: '2rem', color: '#888' }}>
        <button onClick={reset}>Reset</button>
        <p>
          Tokens carry no external monetary value. This is not a regulated gambling product.
          See <code>PROJECT_SPEC.md</code> and <code>spec/</code> for normative behaviour.
        </p>
      </footer>
    </main>
  );
}
