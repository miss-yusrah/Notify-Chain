import { formatError } from './logger';

describe('formatError', () => {
  it('formats Error instances with message, name, and stack', () => {
    const error = new Error('Something went wrong');
    const formatted = formatError(error);

    expect(formatted).toMatchObject({
      message: 'Something went wrong',
      name: 'Error',
      stack: expect.any(String),
    });
  });

  it('formats nested error causes', () => {
    const cause = new Error('Root cause');
    const error = new Error('Wrapper error');
    (error as Error & { cause: Error }).cause = cause;
    const formatted = formatError(error);

    expect(formatted).toMatchObject({
      message: 'Wrapper error',
      cause: {
        message: 'Root cause',
        name: 'Error',
      },
    });
  });

  it('stringifies non-error values', () => {
    expect(formatError('plain string')).toBe('plain string');
    expect(formatError(404)).toBe('404');
  });
});
