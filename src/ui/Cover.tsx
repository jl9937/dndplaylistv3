import { pickCover, type Image } from '../spotify/types';

export function Cover({ images, className = 'cover' }: { images: Image[] | null | undefined; className?: string }) {
  const src = pickCover(images)?.url;
  return src ? <img className={className} src={src} alt="" loading="lazy" /> : <span className={`${className} placeholder`} aria-hidden />;
}
