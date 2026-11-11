import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Username } from './Username';
import * as usernameExports from './Username';
describe('native usernames', () => {
  it('keeps a retained @ handle verbatim and renders no foreign-identity badge', () => {
    const { container } = render(<Username username="exact@retained.invalid" />);
    expect(screen.getByText('exact@retained.invalid')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull(); expect(usernameExports).not.toHaveProperty('FederationGlobeIcon');
  });
  it('preserves the optional @ prefix and supplied text styling', () => {
    render(<Username username="native" showAt className="text-test" />);
    expect(screen.getByText('@native')).toHaveClass('text-test');
  });
});
