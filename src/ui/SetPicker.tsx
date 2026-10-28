import { useRef, useState } from 'react';
import { exportDoc, parseImport } from '../sets/exportImport';
import { createSet, currentSet, deleteSet, renameSet, switchSet, type SetsDoc } from '../sets/sets';
import { updateSets } from '../sets/setsStore';

export function SetPicker({ doc }: { doc: SetsDoc }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cur = currentSet(doc);

  const exportAll = () => {
    const blob = new Blob([exportDoc(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dnd-playlist-sets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const importFile = async (file: File) => {
    const result = parseImport(await file.text());
    if (!result.ok) {
      setMessage(`Import failed: ${result.error}`);
      return;
    }
    const sets = result.doc.sets;
    const tiles = sets.reduce((n, s) => n + s.scenes.length, 0);
    const ok = confirm(
      `Replace your ${doc.sets.length} set(s) with ${sets.length} set(s) from the file (${tiles} tiles)?\n\n` +
        sets.map((s) => `• ${s.name} (${s.scenes.length})`).join('\n'),
    );
    if (!ok) return;
    updateSets(() => result.doc);
    setMessage(`Imported ${sets.length} set(s).`);
  };

  return (
    <div className="set-picker">
      <label htmlFor="set">Set</label>
      <select id="set" value={cur.id} onChange={(e) => updateSets((d) => switchSet(d, e.target.value))}>
        {doc.sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.scenes.length})
          </option>
        ))}
      </select>
      <button
        className="link"
        onClick={() => {
          const name = prompt('Name for the new set:', `Session ${doc.sets.length + 1}`);
          if (name !== null) updateSets((d) => createSet(d, name));
        }}
      >
        New
      </button>
      <button
        className="link"
        onClick={() => {
          const name = prompt('Rename set:', cur.name);
          if (name !== null) updateSets((d) => renameSet(d, cur.id, name));
        }}
      >
        Rename
      </button>
      <button
        className="link"
        onClick={() => confirm(`Delete the set “${cur.name}”? The playlists stay in Spotify.`) && updateSets((d) => deleteSet(d, cur.id))}
      >
        Delete
      </button>
      <span className="sep" aria-hidden>
        |
      </span>
      <button className="link" onClick={exportAll}>
        Export
      </button>
      <button className="link" onClick={() => fileRef.current?.click()}>
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFile(file);
        }}
      />
      {message && <span className="hint subtle">{message}</span>}
    </div>
  );
}
