import type React from 'react';

interface UsernameProps {
  username: string;
  showAt?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Native handles are opaque text, including any retained @ suffix. */
export function Username({ username, showAt, className, style }: UsernameProps) {
  return <span className={className} style={style}>{showAt ? '@' : ''}{username}</span>;
}
