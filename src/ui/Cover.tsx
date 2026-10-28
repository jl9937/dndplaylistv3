import type { Image } from '../spotify/types';

export function coverUrl(images: Image[] | null | undefined): string | null {
  if (!images?.length) return null;
  const ok = images.filter((i) => (i.width ?? 0) >= 96).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (ok[0] ?? images[0]).url;
}

export function Cover({ images, className = 'cover' }: { images: Image[] | null | undefined; className?: string }) {
  const src = coverUrl(images);
  return src ? <img className={className} src={src} alt="" loading="lazy" /> : <span className={`${className} placeholder`} aria-hidden />;
}
