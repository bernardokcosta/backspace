import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { JunoCard } from './JunoCard';
describe('Juno supplied card artwork', () => {
  it('renders an original face with decorative semantics and original dimensions', () => {
    const { container } = render(<JunoCard card={{ id: 'secret-id', color: 'mint', face: '2' }} />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', '/games/juno/cards/mint-2.webp');
    expect(image).toHaveAttribute('alt', ''); expect(image).toHaveAttribute('width', '720');
    expect(image).toHaveAttribute('height', '1056'); expect(container.innerHTML).not.toContain('secret-id');
  });
  it('renders only the original back even if supplied with a private card', () => {
    const { container } = render(<JunoCard back card={{ id: 'hidden-id', color: 'coral', face: '9' }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/games/juno/cards/back.webp');
    expect(container.innerHTML).not.toMatch(/hidden-id|coral|face=/);
  });
});
