# Software Security: TLS-like Secure Mesh Network

A Node.js simulation of a secure mesh network implementing a custom Transport Layer and a TLS-like Handshake protocol for secure communication.

## Features

- **Simulation of Network Layers**:
  - **Transport Layer**: Handles packet fragmentation, reassembly, and reliability over TCP.
  - **Security Layer**: Implements a custom handshake protocol (ClientHello, ServerHello, Premaster Secret) to establish secure sessions.
- **Cryptography**:
  - **RSA-2048**: Used for identity (certificates) and secure key exchange.
  - **AES-256-GCM**: Used for symmetric encryption of application data after the handshake.
  - **Local Certificate Verification**: Nodes verify peer certificates locally against a Root CA public key.
- **CLI**: Interactive command-line interface for each node.

## Prerequisites

- **Node.js** (v18+)
- **npm**
- **tmux** (optional, for the automated startup script)

## How to Run

### Option 1: Automated Startup (Recommended for Linux)

This project includes a helper script `start_all.sh` that automates the setup. It starts the CA and all nodes (defined in `topology.json`) in a `tmux` session with split panes.

1. Make the script executable:

   ```bash
   chmod +x start_all.sh
   ```

2. Run the script:

   ```bash
   ./start_all.sh
   ```

   - This will launch a new tmux session named `secure-net`.
   - The **Certificate Authority (CA)** will start in the top pane.
   - **Nodes (1-5)** will start in the bottom panes.

3. To cleanup/kill all processes:
   The script attempts to kill old processes on start. To manually kill them:
   ```bash
   pkill -f "ts-node src"
   ```

### Option 2: Manual Execution

If you cannot use `tmux` or prefer manual control, run each component in a separate terminal window.

1. **Start the Certificate Authority (CA)**:
   This must be running before any nodes start.

   ```bash
   npx ts-node src/ca.ts
   ```

2. **Start Nodes**:
   Open a new terminal for each node you want to simulate and run:
   ```bash
   npx ts-node src/index.ts <NODE_ID>
   ```
   _Example:_
   - Terminal 2: `npx ts-node src/index.ts 1`
   - Terminal 3: `npx ts-node src/index.ts 2`

## Usage Controls

Once the nodes are running (you will see prompts like `Node 1 >`), you can use the following commands:

- **Connect** (Start Handshake):

  ```text
  connect <TARGET_ID>
  ```

  _Example:_ `connect 2` (initiates TLS handshake with Node 2)

- **Send Message** (Encrypted):

  ```text
  send <TARGET_ID> <MESSAGE>
  ```

  _Example:_ `send 2 Hello World` (Sends textual message. Fails if no secure session exists).

- **Broadcast** (Plaintext):
  ```text
  broadcast <MESSAGE>
  ```
  _Example:_ `broadcast Hello Everyone` (Sends to all neighbors).

## Project Structure

- `src/ca.ts`: Certificate Authority server.
- `src/index.ts`: Entry point for network nodes.
- `src/handshake.ts`: Logic for TLS handshake and session management.
- `src/transport.ts`: Networking, fragmentation, and routing logic.
- `src/cryptoUtils.ts`: Wrappers for 'crypto' module functions.
- `topology.json`: Defines the network graph (nodes and neighbors).
