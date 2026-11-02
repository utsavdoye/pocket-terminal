#!/bin/bash
# Pocket Terminal: Linux installer (started by install.sh). Safe to run again any time.
#
#   1. installs the agent's packages (the terminal part is compiled, so it needs make + a C++ compiler)
#   2. laptops: lets the power brain set wake-up alarms (asks for your password once)
#   3. starts the agent now and at every login (systemd user service)
#   4. shows a QR code: scan it with your phone to pair
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
HOME_DIR="$HOME/.pocket-terminal"
LOG="$HOME_DIR/agent.log"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/pocket-terminal.service"
step() { printf "\n\033[1;34m[%s]\033[0m %s\n" "$1" "$2"; }
NODE="$(command -v node)"
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>18||(a===18&&b>=20)?0:1)' \
  || { echo "Your Node.js is too old ($("$NODE" -v)). Install the LTS from https://nodejs.org"; exit 1; }
mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"

step 1/4 "Installing packages"
if ! command -v make >/dev/null || ! command -v g++ >/dev/null || ! command -v python3 >/dev/null; then
  echo "The terminal part is compiled on Linux, so it needs build tools. Install them, then run this again:"
  if command -v apt >/dev/null; then echo "  sudo apt install -y build-essential python3"
  elif command -v dnf >/dev/null; then echo "  sudo dnf install -y make gcc-c++ python3"
  elif command -v pacman >/dev/null; then echo "  sudo pacman -S --needed base-devel python"
  else echo "  make, g++ and python3"; fi
  exit 1
fi
systemctl --user stop pocket-terminal 2>/dev/null || true   # an update: stop the running agent first
npm ci --omit=dev --no-fund --no-audit --loglevel=error

step 2/4 "Power"
if "$NODE" -e 'process.exit(require("./platform/linux").hasBattery()?0:1)'; then
  RTC="$("$NODE" -p 'require("./platform/linux").RTCWAKE')"
  SUDOERS=/etc/sudoers.d/pocket-terminal
  if [ ! -f "$SUDOERS" ] && [ -x "$RTC" ]; then
    echo "This is a laptop. To check in while asleep, the agent sets wake-up alarms with rtcwake."
    echo "That needs your password once. The agent can ONLY run:  rtcwake -m no -t <time>  and  rtcwake -m disable"
    read -r -p "Allow it? [Y/n] " ans </dev/tty || ans=n
    if [[ ! "$ans" =~ ^[Nn] ]]; then
      TMP="$(mktemp)"; echo "$(whoami) ALL=(root) NOPASSWD: $RTC -m no -t *, $RTC -m disable" > "$TMP"
      sudo visudo -cf "$TMP" >/dev/null && sudo install -m 0440 -o root -g root "$TMP" "$SUDOERS"; rm -f "$TMP"
    fi
  fi
  sudo -n "$RTC" -m disable >/dev/null 2>&1 && echo "Wake-up alarms ready ✅" || echo "Without wake-up alarms: reachable while awake or charging, not while asleep on battery."
else
  echo "No battery: this computer simply stays awake. Nothing to set up."
fi

step 3/4 "Pairing key"
"$NODE" pair.js --list >/dev/null   # saves the settings; pairing comes at the end

step 4/4 "Starting the agent now and at every login"
if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT" <<UNIT
[Unit]
Description=Pocket Terminal agent (your terminal on your phone)
After=network-online.target

[Service]
ExecStart=$NODE $DIR/agent.js
WorkingDirectory=$DIR
Environment=PATH=$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin
Environment=SHELL=${SHELL:-/bin/bash}
Environment=LANG=${LANG:-C.UTF-8}
Restart=always
RestartSec=5
UMask=0077
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now pocket-terminal >/dev/null
  # Keep running after you log out (and start at boot), if this system allows it.
  loginctl enable-linger "$(whoami)" 2>/dev/null || true
else
  echo "No systemd user session here: starting it in the background, and at boot with cron."
  pkill -f "$DIR/agent.js" 2>/dev/null || true
  nohup "$NODE" "$DIR/agent.js" >>"$LOG" 2>&1 &
  if command -v crontab >/dev/null; then
    ( crontab -l 2>/dev/null | grep -v 'pocket-terminal/.*agent.js'; echo "@reboot cd $DIR && $NODE $DIR/agent.js >> $LOG 2>&1" ) | crontab -
  else echo "(No cron either: after a restart, start it again with:  $NODE $DIR/agent.js &)"; fi
fi
sleep 3
if grep -q "agent running" "$LOG" 2>/dev/null; then echo "Agent running ✅"; else echo "Agent started. If something's off, see: $LOG"; fi

echo
if [ -n "${POCKET_SKIP_PAIR:-}" ]; then exit 0; fi
"$NODE" pair.js </dev/tty
