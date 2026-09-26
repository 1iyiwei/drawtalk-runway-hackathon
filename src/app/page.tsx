"use client";

import { useState } from "react";
import styles from "./page.module.css";

type Result = { taskId: string; output: string[] };

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.failureCode ? `${data.error} (${data.failureCode})` : data.error);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.main}>
      <h1>Runway Hackathon</h1>
      <p className={styles.sub}>
        gen4.5 · text → video, or add an image to use as the first frame
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        <label>
          Prompt
          <textarea
            name="prompt"
            rows={4}
            maxLength={1000}
            required
            defaultValue="A timelapse on a sunny day with clouds flying by"
          />
        </label>

        <div className={styles.row}>
          <label>
            Ratio
            <select name="ratio" defaultValue="1280:720">
              <option value="1280:720">1280:720 (landscape)</option>
              <option value="720:1280">720:1280 (portrait)</option>
            </select>
          </label>
          <label>
            Duration (s)
            <input name="duration" type="number" min={2} max={10} defaultValue={5} />
          </label>
        </div>

        <label>
          First frame image (optional)
          <input
            name="image"
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
        </label>
        {preview && <img className={styles.preview} src={preview} alt="First frame" />}

        <button type="submit" disabled={busy}>
          {busy ? "Generating… (can take a minute or two)" : "Generate video"}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {result?.output.map((url) => (
        <figure key={url} className={styles.result}>
          <video src={url} controls autoPlay loop playsInline />
          <figcaption>
            Task {result.taskId} · <a href={url} target="_blank" rel="noreferrer">open</a>{" "}
            (URL expires in 24–48h)
          </figcaption>
        </figure>
      ))}
    </main>
  );
}
