/**
 * Playlist ID from any of:
 *   spotify:playlist:ID
 *   spotify:user:USER:playlist:ID   (legacy)
 *   https://open.spotify.com/playlist/ID?si=…
 *   https://api.spotify.com/v1/playlists/ID
 */
export function parsePlaylistId(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const colon = /^spotify:(?:user:[^:]+:)?playlist:([A-Za-z0-9]+)$/.exec(uri);
  if (colon) return colon[1];
  const web = /^https:\/\/(?:open|api)\.spotify\.com\/(?:v1\/)?playlists?\/([A-Za-z0-9]+)/.exec(uri);
  return web ? web[1] : null;
}

export function playlistUri(id: string): string {
  return `spotify:playlist:${id}`;
}
