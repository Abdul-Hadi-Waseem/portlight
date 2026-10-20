// CI diagnostics: which error does this OS give when a second socket binds `::` over an existing
// `::` listener? Portlight's free-port probe relies on it being reported as "in use".
import net from 'node:net';

const first = net.createServer();
first.listen(0, '::', () => {
  const { port } = first.address();
  const second = net.createServer();
  second.once('error', (error) => {
    console.log(`bind :: (ipv6Only) over a :: listener -> ${error.code}`);
    process.exit(0);
  });
  second.listen({ port, host: '::', ipv6Only: true, exclusive: true }, () => {
    console.log('bind :: (ipv6Only) over a :: listener -> succeeded (the probe cannot see it)');
    process.exit(0);
  });
});
