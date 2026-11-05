import { createFixture } from './local-fixture.mjs';
const fixture = await createFixture({ port: 8792, listen: true, notice: true, bridge: false });
console.log(JSON.stringify({ ready: true, origin: fixture.origin, data: 'synthetic in-memory only', notice: true }));
process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
