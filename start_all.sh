#!/bin/bash

# Cleanup previous instances
echo "Cleaning up any old processes..."
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "tsx src/ca.ts" 2>/dev/null || true
sleep 1

# Define the command to start the CA
CA_CMD="npx tsx src/ca.ts"

# Define the command to start a node (takes ID as argument)
NODE_CMD="npx tsx src/index.ts"

# Detect terminal emulator
if command -v gnome-terminal &> /dev/null; then
    # GNOME Terminal
    echo "Starting CA in GNOME Terminal..."
    gnome-terminal --title="CA Server" -- bash -c "$CA_CMD; exec bash"

    sleep 2 # Wait for CA to start

    for id in {1..5}; do
        echo "Starting Node $id in GNOME Terminal..."
        gnome-terminal --title="Node $id" -- bash -c "$NODE_CMD $id; exec bash"
    done

elif command -v konsole &> /dev/null; then
    # KDE Konsole
    echo "Starting CA in Konsole..."
    konsole -p tabtitle="CA Server" -e bash -c "$CA_CMD; exec bash" &

    sleep 2

    for id in {1..5}; do
        echo "Starting Node $id in Konsole..."
        konsole -p tabtitle="Node $id" -e bash -c "$NODE_CMD $id; exec bash" &
    done

elif command -v xterm &> /dev/null; then
    # xterm (fallback)
    echo "Starting CA in xterm..."
    xterm -T "CA Server" -e "$CA_CMD; exec bash" &

    sleep 2

    for id in {1..5}; do
        echo "Starting Node $id in xterm..."
        xterm -T "Node $id" -e "$NODE_CMD $id; exec bash" &
    done

elif command -v tmux &> /dev/null; then
    # Tmux
    echo "Starting in tmux..."
    SESSION="tls_sim"

    # Kill existing session if it exists
    tmux kill-session -t $SESSION 2>/dev/null

    # Create new session with CA
    tmux new-session -d -s $SESSION -n "CA" "echo 'Starting CA...'; $CA_CMD; bash"

    # Wait a bit
    sleep 2

    # Create windows for nodes
    for id in {1..5}; do
        tmux new-window -t $SESSION:$id -n "Node $id" "echo 'Starting Node $id...'; $NODE_CMD $id; bash"
    done

    # Select CA window and attach
    tmux select-window -t $SESSION:0
    tmux attach-session -t $SESSION

else
    echo "No supported terminal emulator found (gnome-terminal, konsole, xterm, tmux)."
    echo "Starting everything in background (NOT RECOMMENDED for interactive use)."

    $CA_CMD &
    CA_PID=$!
    echo "CA started (PID $CA_PID)"

    sleep 2

    for id in {1..5}; do
        $NODE_CMD $id &
        echo "Node $id started"
    done

    echo "All processes running in background. Use 'kill $CA_PID' and others to stop."
    echo "To interact, please install tmux, xterm, or use a desktop environment."
    wait
fi

echo "Startup sequence initiated."
