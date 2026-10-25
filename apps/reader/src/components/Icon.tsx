import type { CSSProperties } from 'react';
export function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const paths: Record<string, string> = {
    play: 'm8 5 11 7-11 7V5Z',
    plus: 'M12 5v14M5 12h14',
    maximize: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    minimize: 'M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5',
    search: 'm21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    moon: 'M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z',
    book: 'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4V4Zm8 2v15',
    terminal: 'm5 7 4 5-4 5m8 0h6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    external: 'M14 3h7v7m0-7-11 11M10 3H3v18h18v-7',
    chevron: 'm9 5 7 7-7 7',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'm6 6 12 12M6 18 18 6',
    copy: 'M9 9h11v11H9V9ZM5 15H3V3h12v2',
    check: 'm4 12 5 5L20 6',
    globe:
      'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
    code: 'm8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18',
    shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
    bolt: 'm13 2-9 12h7l-1 8L21 9h-8V2Z',
    settings:
      'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z',
    info: 'M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    lock: 'M5 10h14v11H5V10Zm3 0V6a4 4 0 0 1 8 0v4',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
