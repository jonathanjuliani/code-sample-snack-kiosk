import { HandIcon } from '../icons';
import '../styles/attract.css';

export function Attract({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <button type="button" className="attract" onClick={onStart}>
      <p className="brand">{name}</p>
      <h1>Order here.</h1>
      <p className="sub">Pick, pay, and grab it at the counter.</p>
      <span className="pill">
        <HandIcon /> Tap to start
      </span>
    </button>
  );
}
