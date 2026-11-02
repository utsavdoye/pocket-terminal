#!/bin/bash
# Removes Pocket Terminal from this Mac or Linux computer and puts sleep back to normal.
#   bash uninstall.sh          keep your pairing key (~/.pocket-terminal) for later
#   bash uninstall.sh --purge  delete the key too (every paired phone stops working)
if [ "$(uname)" = "Darwin" ]; then
  LABEL="com.pocketterminal.agent"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
  sudo /usr/bin/pmset -a disablesleep 0
else
  systemctl --user disable --now pocket-terminal 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/pocket-terminal.service"; systemctl --user daemon-reload 2>/dev/null || true
  pkill -f 'pocket-terminal.*agent.js' 2>/dev/null || true
  ( crontab -l 2>/dev/null | grep -v 'pocket-terminal/.*agent.js' ) | crontab - 2>/dev/null || true
fi
[ -f /etc/sudoers.d/pocket-terminal ] && sudo rm -f /etc/sudoers.d/pocket-terminal
if [ "$1" = "--purge" ]; then rm -rf "$HOME/.pocket-terminal"; echo "Pairing key deleted."; fi
echo "Pocket Terminal removed. Sleep works normally again."
