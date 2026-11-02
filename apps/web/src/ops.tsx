import {
  defaultSimulation,
  formatCents,
  type OpsKiosk,
  type OpsSummary,
  type PaymentSimulation,
  type Simulation,
  type SimulationResponse,
} from '@kiosk/shared';
import { useEffect, useRef, useState } from 'react';
import { fetchOpsSummary, fetchSimulation, putSimulation } from './api';
import './styles/ops.css';

const REFRESH_MS = 5000;
const STALE_MS = 120_000;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function statusLabel(status: string): string {
  if (status === 'paid') return 'Paid';
  if (status === 'payment_failed') return 'Declined';
  return 'Pending';
}

const PAYMENT_OPTIONS: { value: PaymentSimulation; label: string }[] = [
  { value: 'follow-card', label: 'Follow the card' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'drop-approved', label: 'No response, then approved' },
  { value: 'drop-declined', label: 'No response, then declined' },
  { value: 'unresolved', label: 'No response, never resolves' },
];

export function OpsPage() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [down, setDown] = useState(false);
  const [simError, setSimError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const writeGen = useRef(0);
  const simRef = useRef(simulation);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const seen = writeGen.current;
      try {
        const [next, sim] = await Promise.all([fetchOpsSummary(), fetchSimulation()]);
        if (cancelled) return;
        setSummary(next);
        setNow(Date.now());
        setDown(false);
        if (writeGen.current === seen) {
          simRef.current = sim;
          setSimulation(sim);
        }
      } catch {
        if (!cancelled) setDown(true);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const commit = (patch: Partial<Simulation>) => {
    const prev = simRef.current;
    if (!prev) return;
    const next: Simulation = {
      payment: patch.payment ?? prev.payment,
      paymentsPaused: patch.paymentsPaused ?? prev.paymentsPaused,
      menuFails: patch.menuFails ?? prev.menuFails,
      priceBump: 'priceBump' in patch ? (patch.priceBump ?? null) : prev.priceBump,
      soldOut: 'soldOut' in patch ? (patch.soldOut ?? null) : prev.soldOut,
    };
    const optimistic = { ...prev, ...next };
    simRef.current = optimistic;
    setSimulation(optimistic);
    const gen = ++writeGen.current;
    void putSimulation(next)
      .then((saved) => {
        if (writeGen.current !== gen) return;
        simRef.current = saved;
        setSimulation(saved);
        setSimError(false);
      })
      .catch(() => {
        if (writeGen.current !== gen) return;
        setSimError(true);
      });
  };

  const counters = summary?.counters;

  return (
    <div className="ops-layout">
      <SimulationRail
        simulation={simulation}
        kiosks={summary?.kiosks ?? []}
        down={down}
        simError={simError}
        onCommit={commit}
      />
      <main className="ops">
        <header className="ops-head">
          <div>
            <h1>Counter</h1>
            <p>Open on purpose, with no login. A real counter would sit behind staff sign-in.</p>
          </div>
          <p className="ops-meta">
            Menu version <span className="num">{summary?.menuVersion ?? '—'}</span>
          </p>
        </header>
        {down && !summary ? <p role="status">The counter cannot reach the API.</p> : null}
        <section className="ops-counts" aria-label="Today's counters">
          <Counter label="Duplicate submits absorbed" value={counters?.idempotentReplays} />
          <Counter label="Totals changed" value={counters?.reprices} />
          <Counter label="Cards declined" value={counters?.declines} />
          <Counter label="Idle resets" value={counters?.idleResets} />
        </section>
        <div className="ops-split">
          <section>
            <h2>Kiosks</h2>
            {summary && summary.kiosks.length === 0 ? <p>No kiosk has checked in yet.</p> : null}
            <div className="ops-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Kiosk</th>
                    <th>Last seen</th>
                    <th>App</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.kiosks ?? []).map((kiosk) => {
                    const stale = now - new Date(kiosk.lastSeenAt).getTime() > STALE_MS;
                    return (
                      <tr key={kiosk.kioskId}>
                        <td className="num">{kiosk.kioskId}</td>
                        <td>{formatWhen(kiosk.lastSeenAt)}</td>
                        <td className="num">{kiosk.appVersion || '—'}</td>
                        <td>{stale ? <span className="tag tag-stale">Stale</span> : 'Live'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2>Staff assist</h2>
            {summary && summary.assists.length === 0 ? <p>No open staff requests.</p> : null}
            <div className="ops-scroll">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kiosk</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.assists ?? []).map((assist) => (
                    <tr key={assist.id}>
                      <td>{formatWhen(assist.openedAt)}</td>
                      <td className="num">{assist.kioskId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <section>
          <h2>Last orders</h2>
          <div className="ops-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kiosk</th>
                  <th>Status</th>
                  <th>Pickup</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.orders ?? []).map((order) => (
                  <tr key={order.orderId}>
                    <td>{formatWhen(order.createdAt)}</td>
                    <td className="num">{order.kioskId}</td>
                    <td>
                      <span className={`tag tag-${order.status}`}>{statusLabel(order.status)}</span>
                    </td>
                    <td className="num">{order.pickupNumber ?? '—'}</td>
                    <td className="r num">{formatCents(order.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary && summary.orders.length === 0 ? <p>No orders yet.</p> : null}
        </section>
        <p className="ops-foot">Kiosk ids are shown here only. The customer screen does not display them.</p>
      </main>
    </div>
  );
}

function SimulationRail({
  simulation,
  kiosks,
  down,
  simError,
  onCommit,
}: {
  simulation: SimulationResponse | null;
  kiosks: OpsKiosk[];
  down: boolean;
  simError: boolean;
  onCommit: (patch: Partial<Simulation>) => void;
}) {
  const [raisePick, setRaisePick] = useState('chips');
  const [soldOutPick, setSoldOutPick] = useState('chips');
  const items = simulation?.items ?? [];

  useEffect(() => {
    if (simulation?.priceBump) setRaisePick(simulation.priceBump.itemId);
    if (simulation?.soldOut) setSoldOutPick(simulation.soldOut.itemId);
  }, [simulation]);

  const raiseId = picked(items, raisePick);
  const soldOutId = picked(items, soldOutPick);

  return (
    <aside className="ops-sim" aria-label="Simulation controls">
      <h2>Simulation</h2>
      <p className="ops-sim-hint">These controls are the demo harness, not the counter.</p>
      {down && !simulation ? <p role="status">The counter cannot reach the API.</p> : null}
      {simError ? <p role="status">The simulation did not save. Try again.</p> : null}
      <fieldset disabled={!simulation}>
        <legend>Next payment</legend>
        <select
          aria-label="Next payment"
          value={simulation?.payment ?? 'follow-card'}
          onChange={(event) => {
            onCommit({ payment: event.target.value as PaymentSimulation });
          }}
        >
          {PAYMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </fieldset>
      <fieldset disabled={!simulation}>
        <legend>Server conditions</legend>
        <label>
          <input
            type="checkbox"
            checked={simulation?.paymentsPaused ?? false}
            onChange={(event) => onCommit({ paymentsPaused: event.target.checked })}
          />
          Payments paused
        </label>
        <p className="ops-sim-hint">The kiosk notices within 10 seconds.</p>
        <label>
          <input
            type="checkbox"
            checked={simulation?.menuFails ?? false}
            onChange={(event) => onCommit({ menuFails: event.target.checked })}
          />
          Menu requests fail
        </label>
        <p className="ops-sim-hint">A kiosk that already loaded the menu keeps it.</p>
        <label>
          <input
            type="checkbox"
            checked={Boolean(simulation?.priceBump)}
            onChange={(event) => {
              if (!raiseId) return;
              onCommit({ priceBump: event.target.checked ? { itemId: raiseId } : null });
            }}
          />
          Raise one item by $0.50
        </label>
        <label className="ops-sim-field">
          Item to raise
          <select
            aria-label="Item to raise"
            value={raiseId}
            onChange={(event) => {
              setRaisePick(event.target.value);
              if (!simulation?.priceBump) return;
              onCommit({ priceBump: { itemId: event.target.value } });
            }}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(simulation?.soldOut)}
            onChange={(event) => {
              if (!soldOutId) return;
              onCommit({ soldOut: event.target.checked ? { itemId: soldOutId } : null });
            }}
          />
          Mark one item sold out
        </label>
        <label className="ops-sim-field">
          Item to mark sold out
          <select
            aria-label="Item to mark sold out"
            value={soldOutId}
            onChange={(event) => {
              setSoldOutPick(event.target.value);
              if (!simulation?.soldOut) return;
              onCommit({ soldOut: { itemId: event.target.value } });
            }}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <button type="button" disabled={!simulation} onClick={() => onCommit(defaultSimulation)}>
        Reset simulations
      </button>
      <p className="ops-sim-hint">Clears these flags. Orders, counters, and staff requests stay.</p>
      <fieldset>
        <legend>State</legend>
        <div className="ops-sim-readout">{kioskReadout(kiosks)}</div>
      </fieldset>
    </aside>
  );
}

function picked(items: { id: string }[], preferred: string): string {
  if (items.some((item) => item.id === preferred)) return preferred;
  return items[0]?.id ?? '';
}

function kioskReadout(kiosks: OpsKiosk[]): string {
  if (kiosks.length === 0) return 'Waiting for a heartbeat.';
  return kiosks
    .map((kiosk) => {
      if (!kiosk.screen) return `${kiosk.kioskId}\nno screen reported yet`;
      const total = kiosk.totalCents === null ? '—' : formatCents(kiosk.totalCents);
      const items = kiosk.itemCount ?? 0;
      return `${kiosk.kioskId}\nscreen: ${kiosk.screen}\nphase: ${kiosk.payPhase ?? '—'}\nitems: ${items}  total: ${total}`;
    })
    .join('\n\n');
}

function Counter({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="ops-count">
      <div className="num">{value ?? '—'}</div>
      <div>{label}</div>
    </div>
  );
}
