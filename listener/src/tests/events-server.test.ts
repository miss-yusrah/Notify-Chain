import http from 'http';
import { createEventsServer } from '../api/events-server';

const TEST_PORT = 19876;

function makeRequest(
  path: string,
  options: { headers?: Record<string, string>; method?: string } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: TEST_PORT, path, method: options.method ?? 'GET', headers: options.headers },
      (res) => {
        res.resume(); // drain body
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('correlation ID propagation', () => {
  let server: http.Server;

  beforeAll((done) => {
    server = createEventsServer({
      port: TEST_PORT,
      stellarRpcUrl: 'http://localhost:8000',
    });
    server.listen(TEST_PORT, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  test('generates a correlation ID when none is provided', async () => {
    const { headers } = await makeRequest('/api/events');
    expect(headers['x-correlation-id']).toBeTruthy();
  });

  test('echoes back the caller-supplied correlation ID', async () => {
    const myId = 'my-trace-abc123';
    const { headers } = await makeRequest('/api/events', {
      headers: { 'x-correlation-id': myId },
    });
    expect(headers['x-correlation-id']).toBe(myId);
  });

  test('always includes x-request-id alongside correlation ID', async () => {
    const { headers } = await makeRequest('/api/events');
    expect(headers['x-request-id']).toBeTruthy();
    expect(headers['x-correlation-id']).toBeTruthy();
    expect(headers['x-request-id']).not.toBe(headers['x-correlation-id']);
  });

  test('correlation ID flows through on 404 responses', async () => {
    const myId = 'trace-404-test';
    const { status, headers } = await makeRequest('/no-such-route', {
      headers: { 'x-correlation-id': myId },
    });
    expect(status).toBe(404);
    expect(headers['x-correlation-id']).toBe(myId);
  });
});
