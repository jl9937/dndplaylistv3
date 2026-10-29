// The ambience starter pack (D28): every audio file in the repo's ambience/ folder, found at
// build time. Vite serves each one as a hashed asset from this origin.

export interface Sound {
  /** Stable across builds: the file name, so presets on tiles keep pointing at it. */
  id: string;
  name: string;
  url: string;
}

const files = import.meta.glob('../../ambience/*.{ogg,opus,mp3,m4a,wav,flac,webm}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `{"../../ambience/Tavern crowd.ogg": url}` → sounds sorted by name. */
export function soundsFromFiles(found: Record<string, string>): Sound[] {
  return Object.entries(found)
    .map(([path, url]) => {
      const file = path.slice(path.lastIndexOf('/') + 1);
      const name = file.replace(/\.[^.]+$/, '').trim();
      return { id: file, name, url };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export const sounds: Sound[] = soundsFromFiles(files);
