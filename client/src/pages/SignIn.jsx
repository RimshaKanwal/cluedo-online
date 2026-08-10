import { useState } from "react";
import { signIn } from "../auth";

export default function SignIn({ onSignedIn }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await signIn(username, pin);
      onSignedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card home-card">
      <h2>🔎 Sign In</h2>
      <p className="hint">
        Pick a username and a PIN. First time using that name creates the account; after that, the same PIN signs you
        back in — on any device.
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. Hanan"
            maxLength={20}
            required
          />
        </label>
        <label>
          PIN (4-6 digits)
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 1234"
            inputMode="numeric"
            maxLength={6}
            required
          />
        </label>
        {error && <p className="hint" style={{ color: "#ff8a80" }}>{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
