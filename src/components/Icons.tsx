export function Wheel({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" />
      <circle cx="20" cy="20" r="5" stroke="currentColor" strokeWidth="2" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <path
            key={i}
            d={`M${20 + Math.cos(a) * 6} ${20 + Math.sin(a) * 6}L${20 + Math.cos(a) * 15} ${20 + Math.sin(a) * 15}`}
            stroke="currentColor"
            strokeWidth="1.6"
          />
        );
      })}
    </svg>
  );
}
export function Icon({
  name,
  size = 20,
}: {
  name:
    | 'mic'
    | 'pause'
    | 'play'
    | 'settings'
    | 'book'
    | 'radio'
    | 'arrow'
    | 'close'
    | 'check'
    | 'volume'
    | 'stop'
    | 'plus';
  size?: number;
}) {
  const paths = {
    mic: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 11v1a7 7 0 0014 0v-1M12 19v3m-4 0h8" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m9 5 11 7-11 7z" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" fill="currentColor" />
        <circle cx="15" cy="17" r="3" fill="currentColor" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v15M3 4h5a4 4 0 014 2 4 4 0 014-2h5v15h-5a5 5 0 00-4 2 5 5 0 00-4-2H3z" />
      </>
    ),
    radio: (
      <>
        <path d="M5 8a10 10 0 000 8m14-8a10 10 0 010 8M8 10a5 5 0 000 4m8-4a5 5 0 010 4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    volume: (
      <>
        <path d="m11 5-6 5H2v4h3l6 5zM15 8a6 6 0 010 8m3-11a10 10 0 010 14" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
