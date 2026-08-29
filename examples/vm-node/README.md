# Demiurge VM Node

This example proves a production Node deployment on a persistent virtual machine or bare-metal host. It builds a client bundle and an SSR server bundle, then serves both through the production Node adapter with a reverse proxy sitting in front.

`examples/cloud-run` binds to `0.0.0.0` and relies on a platform load balancer to handle TLS. This example binds to a loopback address (`127.0.0.1`) instead. A reverse proxy terminates TLS and forwards requests.

## Architecture

**Security boundary:**
- The Node process binds to `127.0.0.1:4173` (loopback only). It is not directly reachable from the network.
- A reverse proxy such as nginx or HAProxy runs on the same machine, terminates TLS with real certificates, and forwards requests to the loopback process.
- The app reads the real client IP and protocol from `X-Forwarded-*` headers added by the proxy, configured with `trustProxy: { hops: 1 }`.
- The app never sees untrusted client addresses. It only trusts the reverse proxy one hop away.

**Process management:**
- A systemd unit file (`demiurge-vm-node.service`) manages the Node process.
- On stop, systemd sends `SIGTERM`. The process has a 30 second grace period to finish in-flight requests and exit cleanly.
- Stdout and stderr go to systemd's journal. No file-based logging is needed.

## Build and run without a reverse proxy

To test the app locally without nginx, build and start the Node process on loopback:

```sh
pnpm build
HOST=127.0.0.1 PORT=4173 ALLOWED_HOSTS=localhost NODE_ENV=production pnpm start
```

Curl directly to the loopback address to confirm readiness and serving:

```sh
curl http://127.0.0.1:4173/.well-known/ready
curl http://127.0.0.1:4173/
```

The `ALLOWED_HOSTS=localhost` pattern matches `localhost` on any port. The app binds `127.0.0.1` but the Host header in the HTTP request must match an allowed host.

## Demonstrating X-Forwarded-For header handling

To simulate what the reverse proxy does, send a request with forwarded headers:

```sh
curl http://127.0.0.1:4173/api/client-ip \
  -H "X-Forwarded-For: 203.0.113.42" \
  -H "X-Forwarded-Proto: https" \
  -H "X-Forwarded-Host: example.com" \
  -H "Host: localhost"
```

The response should show:

```json
{"clientIp": "203.0.113.42"}
```

This proves the app correctly reads the forwarded client IP from the proxy's headers.

## Reverse proxy configuration

`nginx.conf` provides a template. In production:

1. Copy the Node app build to the machine, for example `/opt/demiurge-vm-node`.
2. Install and configure nginx. Use the `nginx.conf` template as a starting point.
3. Replace the certificate paths and domain name in the nginx config:
   - `ssl_certificate /etc/nginx/ssl/cert.pem;` — point to your real certificate
   - `ssl_certificate_key /etc/nginx/ssl/key.pem;` — point to your real key
   - `server_name example.com;` — set to your actual domain
4. Reload nginx after changes: `sudo systemctl reload nginx`

The `upstream` block points to `127.0.0.1:4173`, where the Node process binds.

## Systemd service installation

1. Copy the example build to a persistent location:

   ```sh
   sudo mkdir -p /opt/demiurge-vm-node
   sudo cp -r dist/* /opt/demiurge-vm-node/
   sudo cp server.js package.json /opt/demiurge-vm-node/
   sudo chown -R demiurge-vm-node:demiurge-vm-node /opt/demiurge-vm-node
   ```

2. Create a system user (if not present):

   ```sh
   sudo useradd --system --shell /sbin/nologin --home-dir /nonexistent demiurge-vm-node
   ```

3. Install the systemd unit file:

   ```sh
   sudo cp demiurge-vm-node.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

4. Start and enable the service:

   ```sh
   sudo systemctl start demiurge-vm-node
   sudo systemctl enable demiurge-vm-node
   ```

5. Check status:

   ```sh
   sudo systemctl status demiurge-vm-node
   sudo journalctl -u demiurge-vm-node -f
   ```

## What to look at, and why

**Loopback binding.** `server.js` binds to `127.0.0.1` by default (line 42), making the process unreachable except through the proxy on the same machine.

**TrustProxy configuration.** `trustProxy: { hops: 1 }` on line 49 tells the adapter to trust exactly one hop—the reverse proxy. The adapter then reads the client IP from `X-Forwarded-For` and the protocol from `X-Forwarded-Proto`.

**Graceful shutdown.** The systemd unit specifies `KillSignal=SIGTERM`, and `server.js` configures `signals: ["SIGTERM"]` (line 71). When the system stops the service, it sends SIGTERM, and the adapter's shutdown handler:
- Sets the server state to "draining" (so `/.well-known/ready` returns 503)
- Stops accepting new connections
- Waits up to 30 seconds for in-flight requests to finish
- Exits cleanly

**Readiness endpoint.** `/.well-known/ready` returns 200 while `server.isReady()` is true and 503 once draining starts. Monitoring systems can poll this to know when the process is healthy and when it is shutting down.

**Logs to stdout/stderr.** `server.js` uses `console.log()` and `console.error()`. The systemd unit file (lines 43–44) captures these to the journal:

```ini
StandardOutput=journal
StandardError=journal
```

Read logs with `journalctl -u demiurge-vm-node`.

## Building and testing

Build the example as usual:

```sh
pnpm build
pnpm start
```

Integration tests in `tests/integration/vm-node.ts` verify the deployment:
- Build the example
- Start the process on a loopback port
- Confirm readiness
- Test X-Forwarded-For header handling
- Verify graceful shutdown with SIGTERM
