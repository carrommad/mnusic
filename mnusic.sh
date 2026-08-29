#!/usr/bin/env bash
# ==============================================================================
# MNUSIC Launch Launcher Script
# Music for Supercomputers: Generative HPC Ambient Synthesizer
# ==============================================================================

PORT=8080
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR" || exit 1

# Check if port 8080 is in use, otherwise find an available port
if lsof -i:$PORT &> /dev/null || netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
    # Try port 8085 if 8080 is occupied
    PORT=8085
fi

echo "======================================================================"
echo " 🎵 MUSIC FOR SUPERCOMPUTERS - GENERATIVE HPC AMBIENT SYNTHESIZER"
echo "======================================================================"
echo " Starting local web server on port $PORT..."

# Function to launch default browser
launch_browser() {
    sleep 1.2
    URL="http://127.0.0.1:$PORT/index.html"
    echo " Opening application in browser at: $URL"
    
    if command -v xdg-open &> /dev/null; then
        xdg-open "$URL" &> /dev/null &
    elif command -v google-chrome &> /dev/null; then
        google-chrome "$URL" &> /dev/null &
    elif command -v firefox &> /dev/null; then
        firefox "$URL" &> /dev/null &
    fi
}

launch_browser

# Start local server (python3 or python)
if command -v python3 &> /dev/null; then
    python3 -m http.server $PORT
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer $PORT
else
    echo "❌ Error: Python is required to run the local server."
    exit 1
fi
